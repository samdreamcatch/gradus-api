import { describe, expect, it } from "bun:test";
import type { ApiContext } from "./auth";
import { createApiRouteHandler } from "./define-route";
import { claimFoundingCoachTierRoute, restoreFoundingCoachTierRoute } from "./founding-routes";
import type { FoundingTierDeps } from "@/lib/founding-tier.server";

type Row = Record<string, unknown>;

/**
 * One in-memory store behind two Supabase-shaped clients: the RLS client
 * (reads) and the admin (rate-limit rows, idempotency RPCs, billing writes).
 * Mirrors define-route.test.ts's fake, plus a per-client update log so a
 * test can prove which client wrote. Test-only; never shipped.
 */
function createFakeDb(seed: Record<string, Row[]>) {
  const store = new Map<string, Row[]>(Object.entries(seed).map(([t, rows]) => [t, [...rows]]));
  const idempotencyKeys = new Map<string, Row>();
  const updates: Record<"supabase" | "admin", Array<{ table: string; patch: Row }>> = {
    supabase: [],
    admin: [],
  };

  const rowsFor = (table: string) => {
    if (!store.has(table)) store.set(table, []);
    return store.get(table)!;
  };

  function client(name: "supabase" | "admin") {
    function builder(table: string, filters: Array<[string, unknown]>) {
      return {
        select: () => builder(table, filters),
        eq: (column: string, value: unknown) => builder(table, [...filters, [column, value]]),
        async maybeSingle() {
          const match = rowsFor(table).find((row) => filters.every(([c, v]) => row[c] === v));
          return { data: match ?? null, error: null };
        },
        update: (patch: Row) => ({
          async eq(column: string, value: unknown) {
            // The limiter's own counter bumps are plumbing, not billing writes.
            if (table !== "api_rate_limits") updates[name].push({ table, patch });
            for (const row of rowsFor(table)) {
              if (row[column] === value) Object.assign(row, patch);
            }
            return { data: null, error: null };
          },
        }),
      };
    }
    async function rpc(fn: string, params: Row) {
      const rowKey = `${params._user_id}::${params._key}`;
      if (fn === "reserve_idempotency_key") {
        const existing = idempotencyKeys.get(rowKey);
        if (!existing) {
          idempotencyKeys.set(rowKey, {
            request_hash: params._request_hash,
            response_status: null,
            response_body: null,
          });
          return {
            data: [{ state: "reserved", response_status: null, response_body: null }],
            error: null,
          };
        }
        if (existing.response_status == null) {
          return {
            data: [{ state: "in_progress", response_status: null, response_body: null }],
            error: null,
          };
        }
        if (existing.request_hash !== params._request_hash) {
          return {
            data: [{ state: "key_reused", response_status: null, response_body: null }],
            error: null,
          };
        }
        return {
          data: [
            {
              state: "replay",
              response_status: existing.response_status,
              response_body: existing.response_body,
            },
          ],
          error: null,
        };
      }
      if (fn === "complete_idempotency_key") {
        const row = idempotencyKeys.get(rowKey);
        if (row) {
          row.response_status = params._response_status;
          row.response_body = params._response_body;
        }
        return { data: null, error: null };
      }
      if (fn === "release_idempotency_key") {
        const row = idempotencyKeys.get(rowKey);
        if (row && row.response_status == null) idempotencyKeys.delete(rowKey);
        return { data: null, error: null };
      }
      return { data: null, error: { message: `unknown rpc: ${fn}` } };
    }
    return {
      from: (table: string) => ({
        ...builder(table, []),
        async upsert(row: Row, opts: { onConflict: string }) {
          const keys = opts.onConflict.split(",");
          const rows = rowsFor(table);
          const idx = rows.findIndex((r) => keys.every((k) => r[k] === row[k]));
          if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
          else rows.push({ ...row });
          return { data: null, error: null };
        },
      }),
      rpc,
    };
  }

  return {
    supabase: client("supabase") as unknown as ApiContext["supabase"],
    admin: client("admin") as unknown as ApiContext["admin"],
    updates,
    rows: (table: string) => rowsFor(table),
  };
}

function fakeStripe(subs: Array<{ id: string; status: string }>) {
  const envs: string[] = [];
  const canceled: string[] = [];
  let lists = 0;
  const deps: FoundingTierDeps = {
    createStripe: (env) => {
      envs.push(env);
      return {
        subscriptions: {
          list: async () => {
            lists += 1;
            return { data: subs };
          },
          cancel: async (id) => {
            canceled.push(id);
          },
        },
      };
    },
    defaultEnvironment: () => "live",
  };
  return { deps, envs, canceled, lists: () => lists };
}

function setup(profile: Row | null, stripeSubs: Array<{ id: string; status: string }> = []) {
  process.env.API_V1_ENABLED = "true";
  const db = createFakeDb({ coach_profiles: profile ? [profile] : [] });
  const ctx: ApiContext = {
    userId: "user-1",
    supabase: db.supabase,
    admin: db.admin,
    claims: { email: "dana@example.com", userMetadata: {} },
  };
  const stripe = fakeStripe(stripeSubs);
  const deps = { admin: db.admin, authenticate: async () => ctx };
  const claim = createApiRouteHandler(claimFoundingCoachTierRoute(), deps).POST!;
  const restore = createApiRouteHandler(restoreFoundingCoachTierRoute(stripe.deps), deps).POST!;
  const request = (path: "claim" | "restore", init: RequestInit = {}) =>
    new Request(`https://gradus.training/api/v1/coach/founding/${path}`, {
      method: "POST",
      ...init,
      headers: { authorization: "Bearer t", ...(init.headers ?? {}) },
    });
  return { db, stripe, claim, restore, request };
}

const founding = (extra: Row = {}): Row => ({
  id: "coach-1",
  user_id: "user-1",
  founding_coach: true,
  entitlement: "pending",
  organization_id: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  subscription_environment: null,
  free_access_until: "2026-01-01T00:00:00Z",
  ...extra,
});

describe("POST /api/v1/coach/founding/claim", () => {
  it("answers { ok: true } and grants promo_free with free_access_until cleared, through the admin", async () => {
    const { db, claim, request } = setup(founding());
    const res = await claim({ request: request("claim") });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(db.updates.admin).toEqual([
      { table: "coach_profiles", patch: { entitlement: "promo_free", free_access_until: null } },
    ]);
    expect(db.updates.supabase).toEqual([]);
    expect(db.rows("coach_profiles")[0]).toMatchObject({
      entitlement: "promo_free",
      free_access_until: null,
    });
  });

  it("ignores any request body: no input is declared", async () => {
    const { db, claim, request } = setup(founding());
    const res = await claim({
      request: request("claim", {
        headers: { "content-type": "application/json" },
        body: "this is not json",
      }),
    });
    expect(res.status).toBe(200);
    expect(db.updates.admin).toHaveLength(1);
  });

  it("answers 409 not_founding_coach in the API error shape", async () => {
    const { claim, request } = setup(founding({ founding_coach: false }));
    const res = await claim({ request: request("claim") });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "not_founding_coach", message: "This account isn't a founding coach." },
    });
  });

  it("answers 403 wrong_role for a parent account and never creates a coach row", async () => {
    const { db, claim, request } = setup(null);
    const res = await claim({ request: request("claim") });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("wrong_role");
    expect(db.rows("coach_profiles")).toEqual([]);
  });

  it("answers 401 without a bearer token", async () => {
    const { db, request } = setup(founding());
    const unauth = createApiRouteHandler(claimFoundingCoachTierRoute(), {
      admin: db.admin,
      authenticate: async () => null,
    }).POST!;
    const res = await unauth({ request: request("claim") });
    expect(res.status).toBe(401);
    expect(db.updates.admin).toEqual([]);
  });

  it("is idempotent: a second call with the same Idempotency-Key replays the stored response", async () => {
    const { db, claim, request } = setup(founding());
    const first = await claim({
      request: request("claim", { headers: { "idempotency-key": "k1" } }),
    });
    expect(first.status).toBe(200);
    const second = await claim({
      request: request("claim", { headers: { "idempotency-key": "k1" } }),
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true });
    expect(db.updates.admin).toHaveLength(1);
  });
});

describe("POST /api/v1/coach/founding/restore", () => {
  const paidPro = (extra: Row = {}) =>
    founding({
      entitlement: "paid",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      subscription_environment: "sandbox",
      subscription_tier: "coach_pro",
      subscription_status: "active",
      ...extra,
    });

  it("cancels the paid subscription and answers { ok: true }", async () => {
    const { db, stripe, restore, request } = setup(paidPro(), [{ id: "sub_1", status: "active" }]);
    const res = await restore({ request: request("restore") });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(stripe.envs).toEqual(["sandbox"]);
    expect(stripe.canceled).toEqual(["sub_1"]);
    expect(db.updates.admin).toEqual([
      {
        table: "coach_profiles",
        patch: {
          entitlement: "promo_free",
          subscription_tier: null,
          subscription_status: "canceled",
          stripe_subscription_id: null,
          trial_ends_at: null,
          current_period_end: null,
        },
      },
    ]);
    expect(db.updates.supabase).toEqual([]);
  });

  it("never takes the Stripe environment from the request: a body naming the other account is ignored", async () => {
    const { stripe, restore, request } = setup(paidPro({ subscription_environment: null }), []);
    const res = await restore({
      request: request("restore", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ environment: "sandbox" }),
      }),
    });
    expect(res.status).toBe(200);
    // The profile carries none, so the server's own default applies.
    expect(stripe.envs).toEqual(["live"]);
  });

  it("answers 409 nothing_to_restore for a founding coach already on the free tier, without touching Stripe or the row", async () => {
    const { db, stripe, restore, request } = setup(paidPro({ entitlement: "promo_free" }), [
      { id: "sub_1", status: "active" },
    ]);
    const res = await restore({ request: request("restore") });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "nothing_to_restore",
        message: "Nothing to switch — you're already on the free Founding Coach plan.",
      },
    });
    expect(stripe.lists()).toBe(0);
    expect(db.updates.admin).toEqual([]);
  });

  it("answers 409 club_covered while club-linked", async () => {
    const { db, restore, request } = setup(paidPro({ organization_id: "org-1" }));
    const res = await restore({ request: request("restore") });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({
      code: "club_covered",
      message: "You're on a club plan. Leave the club before switching tiers.",
    });
    expect(db.updates.admin).toEqual([]);
  });

  it("replays under the same Idempotency-Key without a second round of Stripe cancels", async () => {
    const { stripe, restore, request } = setup(paidPro(), [{ id: "sub_1", status: "active" }]);
    const first = await restore({
      request: request("restore", { headers: { "idempotency-key": "r1" } }),
    });
    expect(first.status).toBe(200);
    const second = await restore({
      request: request("restore", { headers: { "idempotency-key": "r1" } }),
    });
    expect(second.status).toBe(200);
    expect(stripe.lists()).toBe(1);
    expect(stripe.canceled).toEqual(["sub_1"]);
  });

  it("is rate-limited to 5 per hour per user (a Stripe-affecting write)", async () => {
    const { restore, request } = setup(paidPro({ entitlement: "promo_free" }));
    for (let i = 0; i < 5; i += 1) {
      expect((await restore({ request: request("restore") })).status).toBe(409);
    }
    const sixth = await restore({ request: request("restore") });
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("retry-after")).toBeTruthy();
  });
});
