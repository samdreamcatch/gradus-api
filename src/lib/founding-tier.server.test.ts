import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  claimFoundingCoachTier,
  defaultStripeEnvironment,
  restoreFoundingCoachTier,
  restoreFoundingCoachTierInput,
  type FoundingStripeClient,
  type FoundingTierContext,
  type FoundingTierDeps,
} from "./founding-tier.server";
import type { StripeEnv } from "./stripe.server";

type Row = Record<string, unknown>;
type Update = { table: string; patch: Row; filters: Array<[string, unknown]> };

/**
 * A chainable Supabase-shaped fake for the two shapes this module uses:
 * `.from(t).select().eq().maybeSingle()` (answered by `rows[t]`, or
 * `readError`) and `.from(t).update(patch).eq()` (recorded in `updates`,
 * answered by `updateError`). One instance per client so a test can prove
 * which client — RLS or service role — performed a write.
 */
function fakeClient(
  rows: Record<string, Row | null> = {},
  errors: { readError?: { message: string }; updateError?: { message: string } } = {},
) {
  const calls: string[] = [];
  const updates: Update[] = [];
  const builder = (table: string, filters: Array<[string, unknown]>) => ({
    select: () => {
      calls.push(`${table}.select`);
      return builder(table, filters);
    },
    eq: (column: string, value: unknown) => builder(table, [...filters, [column, value]]),
    maybeSingle: async () =>
      errors.readError
        ? { data: null, error: errors.readError }
        : { data: rows[table] ?? null, error: null },
    insert: () => {
      calls.push(`${table}.insert`);
      throw new Error("insert is not expected");
    },
    update: (patch: Row) => ({
      eq: async (column: string, value: unknown) => {
        calls.push(`${table}.update`);
        updates.push({ table, patch, filters: [[column, value]] });
        return { data: null, error: errors.updateError ?? null };
      },
    }),
  });
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: { from: (table: string) => builder(table, []) } as any,
    calls,
    updates,
  };
}

function context(
  profile: Row | null,
  errors: { readError?: { message: string }; updateError?: { message: string } } = {},
) {
  const supabase = fakeClient({ coach_profiles: profile }, { readError: errors.readError });
  // The admin never reads here; any read through it would answer "no row".
  const admin = fakeClient({}, { updateError: errors.updateError });
  const ctx: FoundingTierContext = {
    userId: "user-1",
    supabase: supabase.client,
    admin: admin.client,
  };
  return { ctx, supabase, admin };
}

/** A stubbed Stripe: records the environment it was built for and every cancel. */
function fakeStripe(
  subs: Array<{ id: string; status: string }>,
  behavior: { listError?: unknown; cancelErrors?: string[] } = {},
) {
  const envs: StripeEnv[] = [];
  const canceled: string[] = [];
  const listParams: unknown[] = [];
  const client: FoundingStripeClient = {
    subscriptions: {
      list: async (params) => {
        listParams.push(params);
        if (behavior.listError) throw behavior.listError;
        return { data: subs };
      },
      cancel: async (id) => {
        if (behavior.cancelErrors?.includes(id)) throw new Error(`cannot cancel ${id}`);
        canceled.push(id);
      },
    },
  };
  const deps: FoundingTierDeps = {
    createStripe: (env) => {
      envs.push(env);
      return client;
    },
    defaultEnvironment: () => "sandbox",
  };
  return { deps, envs, canceled, listParams };
}

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (err) {
    return err;
  }
}

const founding = (extra: Row = {}): Row => ({
  id: "coach-1",
  founding_coach: true,
  entitlement: "pending",
  organization_id: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  subscription_environment: null,
  ...extra,
});

const paidPro = (extra: Row = {}): Row =>
  founding({
    entitlement: "paid",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_active",
    subscription_environment: "sandbox",
    ...extra,
  });

const RESTORE_PATCH = {
  entitlement: "promo_free",
  subscription_tier: null,
  subscription_status: "canceled",
  stripe_subscription_id: null,
  trial_ends_at: null,
  current_period_end: null,
};

describe("claimFoundingCoachTier", () => {
  it("grants promo_free through the admin client, targeting the profile id (web parity)", async () => {
    const { ctx, supabase, admin } = context(founding());
    expect(await claimFoundingCoachTier(ctx)).toEqual({ ok: true });
    expect(admin.updates).toEqual([
      {
        table: "coach_profiles",
        patch: { entitlement: "promo_free" },
        filters: [["id", "coach-1"]],
      },
    ]);
    // The RLS client only reads; the guarded column is never written through it.
    expect(supabase.updates).toEqual([]);
    expect(supabase.calls).toEqual(["coach_profiles.select"]);
  });

  it("E1 (apiContract): also clears free_access_until so a lapsed club-exit grace can't keep the coach pending", async () => {
    const { ctx, admin } = context(founding({ free_access_until: "2026-01-01T00:00:00Z" }));
    expect(await claimFoundingCoachTier(ctx, { apiContract: true })).toEqual({ ok: true });
    expect(admin.updates).toEqual([
      {
        table: "coach_profiles",
        patch: { entitlement: "promo_free", free_access_until: null },
        filters: [["id", "coach-1"]],
      },
    ]);
  });

  it("E1 (apiContract): re-grants a founding coach whose club-exit grace lapsed (raw promo_free + past free_access_until), clearing the date", async () => {
    // applyClubExitGrace writes raw `promo_free` + a +90-day date and nothing
    // rewrites the row once it passes; getCoachProfile reports `pending`.
    const { ctx, supabase, admin } = context(
      founding({ entitlement: "promo_free", free_access_until: "2026-01-01T00:00:00Z" }),
    );
    expect(await claimFoundingCoachTier(ctx, { apiContract: true })).toEqual({ ok: true });
    expect(admin.updates).toEqual([
      {
        table: "coach_profiles",
        patch: { entitlement: "promo_free", free_access_until: null },
        filters: [["id", "coach-1"]],
      },
    ]);
    expect(supabase.updates).toEqual([]);
  });

  it("E1 (apiContract): a promo_free coach whose grace is still running is entitled today — no write", async () => {
    const { ctx, admin } = context(
      founding({ entitlement: "promo_free", free_access_until: "2099-01-01T00:00:00Z" }),
    );
    expect(await claimFoundingCoachTier(ctx, { apiContract: true })).toEqual({ ok: true });
    expect(admin.updates).toEqual([]);
  });

  it("E1 (apiContract): a promo_free coach with no grace date at all stays a no-op", async () => {
    const { ctx, admin } = context(
      founding({ entitlement: "promo_free", free_access_until: null }),
    );
    expect(await claimFoundingCoachTier(ctx, { apiContract: true })).toEqual({ ok: true });
    expect(admin.updates).toEqual([]);
  });

  it("web parity: without apiContract a lapsed club-exit grace is still the silent no-op the web has today", async () => {
    const { ctx, admin } = context(
      founding({ entitlement: "promo_free", free_access_until: "2026-01-01T00:00:00Z" }),
    );
    expect(await claimFoundingCoachTier(ctx)).toEqual({ ok: true });
    expect(admin.updates).toEqual([]);
  });

  it("refuses a non-founding coach with 409 not_founding_coach and the web's message", async () => {
    const { ctx, admin } = context(founding({ founding_coach: false }));
    const err = await caught(() => claimFoundingCoachTier(ctx));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      code: "not_founding_coach",
      status: 409,
      message: "This account isn't a founding coach.",
    });
    expect(admin.updates).toEqual([]);
  });

  it("is a no-op for a club-linked coach", async () => {
    const { ctx, admin } = context(founding({ organization_id: "org-1" }));
    expect(await claimFoundingCoachTier(ctx)).toEqual({ ok: true });
    expect(admin.updates).toEqual([]);
  });

  for (const entitlement of ["promo_free", "paid", "club_covered"]) {
    it(`is a no-op when the entitlement is already ${entitlement}`, async () => {
      const { ctx, admin } = context(founding({ entitlement }));
      expect(await claimFoundingCoachTier(ctx, { apiContract: true })).toEqual({ ok: true });
      expect(admin.updates).toEqual([]);
    });
  }

  it("answers 403 wrong_role without a coach row and never creates one", async () => {
    const { ctx, supabase, admin } = context(null);
    const err = await caught(() => claimFoundingCoachTier(ctx));
    expect(err).toMatchObject({
      code: "wrong_role",
      status: 403,
      message: "Coach profile not found.",
    });
    expect(admin.calls).toEqual([]);
    expect(supabase.calls).toEqual(["coach_profiles.select"]);
  });

  it("maps a failed profile read to the sanitized dbError, not an ApiError", async () => {
    const { ctx, admin } = context(null, { readError: { message: "relation coach_profiles..." } });
    const err = await caught(() => claimFoundingCoachTier(ctx));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as Error).message).toBe("Something went wrong. Please try again.");
    expect(admin.updates).toEqual([]);
  });

  it("maps a failed admin update to the sanitized dbError", async () => {
    const { ctx } = context(founding(), { updateError: { message: "42501 permission denied" } });
    const err = await caught(() => claimFoundingCoachTier(ctx));
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as Error).message).toBe("Something went wrong. Please try again.");
  });
});

describe("restoreFoundingCoachTier", () => {
  it("cancels only active/trialing/past_due subs on the coach's customer, then rewrites billing via the admin client", async () => {
    const { ctx, supabase, admin } = context(paidPro());
    const stripe = fakeStripe([
      { id: "sub_active", status: "active" },
      { id: "sub_old", status: "canceled" },
      { id: "sub_trial", status: "trialing" },
      { id: "sub_late", status: "past_due" },
      { id: "sub_inc", status: "incomplete" },
    ]);
    const out = await restoreFoundingCoachTier(ctx, {}, { apiContract: true }, stripe.deps);
    expect(out).toEqual({ ok: true });
    expect(stripe.listParams).toEqual([{ customer: "cus_1", status: "all", limit: 20 }]);
    expect(stripe.canceled).toEqual(["sub_active", "sub_trial", "sub_late"]);
    expect(admin.updates).toEqual([
      { table: "coach_profiles", patch: RESTORE_PATCH, filters: [["id", "coach-1"]] },
    ]);
    expect(supabase.updates).toEqual([]);
    // founding_pro_trial_used and stripe_customer_id are untouched.
    expect("founding_pro_trial_used" in admin.updates[0].patch).toBe(false);
    expect("stripe_customer_id" in admin.updates[0].patch).toBe(false);
  });

  it("uses the profile's own Stripe environment over anything the caller supplied", async () => {
    const { ctx } = context(paidPro({ subscription_environment: "live" }));
    const stripe = fakeStripe([]);
    await restoreFoundingCoachTier(ctx, { environment: "sandbox" }, {}, stripe.deps);
    expect(stripe.envs).toEqual(["live"]);
  });

  it("falls back to the web's explicit environment when the profile carries none", async () => {
    const { ctx } = context(paidPro({ subscription_environment: null }));
    const stripe = fakeStripe([]);
    await restoreFoundingCoachTier(ctx, { environment: "live" }, {}, stripe.deps);
    expect(stripe.envs).toEqual(["live"]);
  });

  it("derives the environment server-side when neither the profile nor the caller has one (API)", async () => {
    const { ctx } = context(paidPro({ subscription_environment: "unknown" }));
    const stripe = fakeStripe([]);
    await restoreFoundingCoachTier(ctx, {}, { apiContract: true }, stripe.deps);
    expect(stripe.envs).toEqual(["sandbox"]);
  });

  it("skips Stripe entirely without a customer id and still rewrites billing", async () => {
    const { ctx, admin } = context(paidPro({ stripe_customer_id: null }));
    const stripe = fakeStripe([{ id: "sub_active", status: "active" }]);
    expect(await restoreFoundingCoachTier(ctx, {}, { apiContract: true }, stripe.deps)).toEqual({
      ok: true,
    });
    expect(stripe.envs).toEqual([]);
    expect(stripe.canceled).toEqual([]);
    expect(admin.updates).toHaveLength(1);
  });

  it("answers 502 stripe_error with Stripe's message before any database write when the list fails", async () => {
    const { ctx, admin } = context(paidPro());
    const stripe = fakeStripe([], {
      listError: {
        message: "No such customer",
        type: "invalid_request_error",
        code: "resource_missing",
      },
    });
    const err = await caught(() =>
      restoreFoundingCoachTier(ctx, {}, { apiContract: true }, stripe.deps),
    );
    expect(err).toMatchObject({
      code: "stripe_error",
      status: 502,
      message: "No such customer (invalid_request_error, resource_missing)",
    });
    expect(admin.updates).toEqual([]);
  });

  it("answers 502 stripe_error when the Stripe client can't be built (unconfigured key)", async () => {
    const { ctx, admin } = context(paidPro());
    const deps: FoundingTierDeps = {
      createStripe: () => {
        throw new Error("STRIPE_SANDBOX_API_KEY is not configured");
      },
      defaultEnvironment: () => "live",
    };
    const err = await caught(() => restoreFoundingCoachTier(ctx, {}, {}, deps));
    expect(err).toMatchObject({
      code: "stripe_error",
      status: 502,
      message: "STRIPE_SANDBOX_API_KEY is not configured",
    });
    expect(admin.updates).toEqual([]);
  });

  it("keeps going when one cancel fails (best effort, parity) and still rewrites billing", async () => {
    const { ctx, admin } = context(paidPro());
    const stripe = fakeStripe(
      [
        { id: "sub_a", status: "active" },
        { id: "sub_b", status: "trialing" },
      ],
      { cancelErrors: ["sub_a"] },
    );
    expect(await restoreFoundingCoachTier(ctx, {}, { apiContract: true }, stripe.deps)).toEqual({
      ok: true,
    });
    expect(stripe.canceled).toEqual(["sub_b"]);
    expect(admin.updates).toHaveLength(1);
  });

  it("refuses a club-linked coach with 409 club_covered, touching neither Stripe nor the database", async () => {
    const { ctx, admin } = context(paidPro({ organization_id: "org-1" }));
    const stripe = fakeStripe([{ id: "sub_active", status: "active" }]);
    const err = await caught(() =>
      restoreFoundingCoachTier(ctx, {}, { apiContract: true }, stripe.deps),
    );
    expect(err).toMatchObject({
      code: "club_covered",
      status: 409,
      message: "You're on a club plan. Leave the club before switching tiers.",
    });
    expect(stripe.envs).toEqual([]);
    expect(admin.updates).toEqual([]);
  });

  it("refuses a non-founding coach with 409 not_founding_coach", async () => {
    const { ctx, admin } = context(paidPro({ founding_coach: false }));
    const stripe = fakeStripe([]);
    const err = await caught(() => restoreFoundingCoachTier(ctx, {}, {}, stripe.deps));
    expect(err).toMatchObject({
      code: "not_founding_coach",
      status: 409,
      message: "This account isn't a founding coach.",
    });
    expect(admin.updates).toEqual([]);
  });

  it("answers 403 wrong_role without a coach row", async () => {
    const { ctx, admin } = context(null);
    const stripe = fakeStripe([]);
    const err = await caught(() => restoreFoundingCoachTier(ctx, {}, {}, stripe.deps));
    expect(err).toMatchObject({
      code: "wrong_role",
      status: 403,
      message: "Coach profile not found.",
    });
    expect(admin.calls).toEqual([]);
  });

  it("no longer swallows a failed profile read as 'Coach profile not found.'", async () => {
    const { ctx, admin } = context(null, { readError: { message: "connection reset" } });
    const stripe = fakeStripe([]);
    const err = await caught(() => restoreFoundingCoachTier(ctx, {}, {}, stripe.deps));
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as Error).message).toBe("Something went wrong. Please try again.");
    expect(admin.updates).toEqual([]);
  });

  for (const entitlement of ["promo_free", "pending", "club_covered"]) {
    it(`apiContract: refuses with 409 nothing_to_restore when the entitlement is ${entitlement}`, async () => {
      const { ctx, admin } = context(paidPro({ entitlement }));
      const stripe = fakeStripe([{ id: "sub_active", status: "active" }]);
      const err = await caught(() =>
        restoreFoundingCoachTier(ctx, {}, { apiContract: true }, stripe.deps),
      );
      expect(err).toMatchObject({
        code: "nothing_to_restore",
        status: 409,
        message: "Nothing to switch — you're already on the free Founding Coach plan.",
      });
      expect(stripe.envs).toEqual([]);
      expect(admin.updates).toEqual([]);
    });
  }

  it("web parity: without apiContract an already-free founding coach is still rewritten", async () => {
    const { ctx, admin } = context(paidPro({ entitlement: "promo_free" }));
    const stripe = fakeStripe([]);
    expect(
      await restoreFoundingCoachTier(ctx, { environment: "sandbox" }, {}, stripe.deps),
    ).toEqual({ ok: true });
    expect(admin.updates).toEqual([
      { table: "coach_profiles", patch: RESTORE_PATCH, filters: [["id", "coach-1"]] },
    ]);
  });

  it("club_covered wins over nothing_to_restore for a club-linked coach", async () => {
    const { ctx } = context(paidPro({ entitlement: "club_covered", organization_id: "org-1" }));
    const stripe = fakeStripe([]);
    const err = await caught(() =>
      restoreFoundingCoachTier(ctx, {}, { apiContract: true }, stripe.deps),
    );
    expect(err).toMatchObject({ code: "club_covered" });
  });

  it("maps a failed admin update to the sanitized dbError after the Stripe cancels ran", async () => {
    const { ctx } = context(paidPro(), { updateError: { message: "42501 permission denied" } });
    const stripe = fakeStripe([{ id: "sub_active", status: "active" }]);
    const err = await caught(() =>
      restoreFoundingCoachTier(ctx, {}, { apiContract: true }, stripe.deps),
    );
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as Error).message).toBe("Something went wrong. Please try again.");
    expect(stripe.canceled).toEqual(["sub_active"]);
  });
});

describe("restore inputs and environment defaults", () => {
  it("the web input requires a sandbox|live environment", () => {
    expect(restoreFoundingCoachTierInput.parse({ environment: "live" })).toEqual({
      environment: "live",
    });
    expect(() => restoreFoundingCoachTierInput.parse({ environment: "prod" })).toThrow();
    expect(() => restoreFoundingCoachTierInput.parse({})).toThrow();
  });

  it("the server-side default never throws and is always a known environment", () => {
    expect(["sandbox", "live"]).toContain(defaultStripeEnvironment());
  });
});
