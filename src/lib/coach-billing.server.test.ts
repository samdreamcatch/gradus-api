import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import type { CoachProfileDTO } from "./coach-profile-types";
import {
  BILLING_MANAGE_URL,
  BILLING_PAYWALL_URL,
  billingManageUrl,
  getCoachBilling,
  toCoachBilling,
} from "./coach-billing.server";

/**
 * A chainable fake that records every `table.method` call: `rows[table]`
 * answers `maybeSingle`/`single`, `lists[table]` answers awaited selects, and
 * `counts[table]` fills `count` for head/count reads.
 */
function fakeClient(
  rows: Record<string, unknown | null>,
  lists: Record<string, unknown[]> = {},
  counts: Record<string, number> = {},
) {
  const calls: string[] = [];
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit", "update", "delete", "insert"]) {
      self[m] = () => {
        calls.push(`${table}.${m}`);
        return self;
      };
    }
    self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    self.single = async () => ({ data: rows[table] ?? null, error: null });
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: lists[table] ?? [], count: counts[table] ?? null, error: null });
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from: (table: string) => chain(table) } as any, calls };
}

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

const profile: CoachProfileDTO = {
  id: "coach-1",
  firstName: "Dana",
  lastName: "Wallace",
  onboardedAt: "2026-01-01T00:00:00Z",
  entitlement: "paid",
  organizationId: null,
  organizationName: null,
  subscriptionTier: "coach_pro",
  subscriptionStatus: "active",
  trialEndsAt: null,
  currentPeriodEnd: "2026-10-01T00:00:00Z",
  hasStripeCustomer: true,
  promoCode: "SPRING",
  promoLabel: "Spring 20% off",
  promoPercentOff: 20,
  effectiveTier: "coach_pro",
  athleteLimit: 50,
  athleteCount: 7,
  foundingCoach: false,
  foundingProTrialUsed: true,
  freeAccessUntil: null,
  trialNeedsCard: false,
  subscriptionEnvironment: "live",
  billingPastDue: false,
  checklist: {
    identityVerification: false,
    payoutSetup: false,
    uploadProfilePhoto: false,
    saveFirstPlan: false,
  },
};

describe("toCoachBilling", () => {
  it("projects the billing fields and the web manage link, nothing else", () => {
    const billing = toCoachBilling(profile);
    expect(billing).toEqual({
      entitlement: "paid",
      effectiveTier: "coach_pro",
      subscriptionTier: "coach_pro",
      subscriptionStatus: "active",
      trialEndsAt: null,
      currentPeriodEnd: "2026-10-01T00:00:00Z",
      hasStripeCustomer: true,
      foundingCoach: false,
      foundingProTrialUsed: true,
      freeAccessUntil: null,
      trialNeedsCard: false,
      billingPastDue: false,
      athleteLimit: 50,
      athleteCount: 7,
      organizationName: null,
      promoLabel: "Spring 20% off",
      promoPercentOff: 20,
      manageUrl: BILLING_MANAGE_URL,
    });
    expect("promoCode" in billing).toBe(false);
    expect("id" in billing).toBe(false);
  });

  it("links the settings portal only for a live paid subscription, the paywall otherwise", () => {
    expect(
      billingManageUrl({
        entitlement: "paid",
        hasStripeCustomer: true,
        subscriptionStatus: "active",
      }),
    ).toBe(BILLING_MANAGE_URL);
    expect(
      billingManageUrl({
        entitlement: "paid",
        hasStripeCustomer: true,
        subscriptionStatus: "past_due",
      }),
    ).toBe(BILLING_MANAGE_URL);
    expect(
      billingManageUrl({
        entitlement: "paid",
        hasStripeCustomer: true,
        subscriptionStatus: "canceled",
      }),
    ).toBe(BILLING_PAYWALL_URL);
    expect(
      billingManageUrl({
        entitlement: "paid",
        hasStripeCustomer: false,
        subscriptionStatus: "active",
      }),
    ).toBe(BILLING_PAYWALL_URL);
    expect(
      billingManageUrl({
        entitlement: "pending",
        hasStripeCustomer: false,
        subscriptionStatus: null,
      }),
    ).toBe(BILLING_PAYWALL_URL);
    expect(
      billingManageUrl({
        entitlement: "promo_free",
        hasStripeCustomer: false,
        subscriptionStatus: null,
      }),
    ).toBe(BILLING_PAYWALL_URL);
    expect(
      toCoachBilling({
        ...profile,
        entitlement: "promo_free",
        hasStripeCustomer: false,
        subscriptionStatus: null,
      }).manageUrl,
    ).toBe(BILLING_PAYWALL_URL);
  });
});

describe("getCoachBilling", () => {
  it("refuses a caller without a coach row (403 wrong_role) and never creates one", async () => {
    const supabase = fakeClient({});
    const admin = fakeClient({});
    const err = await caught(() =>
      getCoachBilling({ userId: "u", supabase: supabase.client, admin: admin.client }),
    );
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("wrong_role");
    expect(err?.message).toBe("This account is not a coach.");
    expect(admin.calls.filter((c) => c.endsWith(".insert"))).toEqual([]);
    expect(supabase.calls.filter((c) => c.endsWith(".insert"))).toEqual([]);
    // The guard answers before `ensureCoachProfile` gets to look for a parent row.
    expect(supabase.calls.some((c) => c.startsWith("parent_profiles."))).toBe(false);
  });

  it("projects getCoachProfile's output for a coach", async () => {
    const row = {
      id: "coach-1",
      first_name: "Dana",
      last_name: "Wallace",
      // Not onboarded: keeps the founding-coach backfill from writing.
      onboarded_at: null,
      entitlement: "paid",
      organization_id: "org-1",
      subscription_tier: "coach_pro",
      subscription_status: "active",
      trial_ends_at: null,
      current_period_end: "2026-10-01T00:00:00Z",
      subscription_environment: "live",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      promo_code: "SPRING",
      founding_coach: false,
      founding_pro_trial_used: true,
      free_access_until: null,
    };
    const supabase = fakeClient(
      { coach_profiles: row, organizations: { name: "Ice Club" } },
      { coach_levels: [] },
      { coach_athletes: 7 },
    );
    const admin = fakeClient({
      promo_codes: { label: "Spring 20% off", percent_off: 20, active: true },
    });
    const billing = await getCoachBilling({
      userId: "u",
      supabase: supabase.client,
      admin: admin.client,
    });
    expect(billing).toEqual({
      entitlement: "paid",
      effectiveTier: "club",
      subscriptionTier: "coach_pro",
      subscriptionStatus: "active",
      trialEndsAt: null,
      currentPeriodEnd: "2026-10-01T00:00:00Z",
      hasStripeCustomer: true,
      foundingCoach: false,
      foundingProTrialUsed: true,
      freeAccessUntil: null,
      trialNeedsCard: false,
      billingPastDue: false,
      athleteLimit: null,
      athleteCount: 7,
      organizationName: "Ice Club",
      promoLabel: "Spring 20% off",
      promoPercentOff: 20,
      manageUrl: BILLING_MANAGE_URL,
    });
    expect(admin.calls.filter((c) => c.endsWith(".insert"))).toEqual([]);
  });
});
