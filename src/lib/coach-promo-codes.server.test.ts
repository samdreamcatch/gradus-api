import { describe, expect, it } from "bun:test";
import {
  checkPromoForPlan,
  createCoachPromoCode,
  createPromoCodeInput,
  deleteCoachPromoCode,
  discountedCents,
  getCoachPromoCode,
  listCoachPromoCodes,
  promoCodeCounts,
  resolvePromoForPlan,
  updateCoachPromoCode,
  updatePromoCodeInput,
} from "./coach-promo-codes.server";

type Row = Record<string, unknown>;

/** A small table store: `.eq()`/`.in()` filter rows; `insert`/`update`/`delete` change them. */
function fakeAdmin(tables: Record<string, Row[]>) {
  const admin = {
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const inFilters: [string, unknown[]][] = [];
      let insertRows: Row[] | null = null;
      let patch: Row | null = null;
      let remove = false;
      const all = () => (tables[table] ??= []);
      const matching = () =>
        all().filter(
          (r) =>
            filters.every(([c, v]) => r[c] === v) &&
            inFilters.every(([c, vs]) => vs.includes(r[c])),
        );
      const run = () => {
        if (insertRows) {
          const made = insertRows.map((r, i) => ({
            id: `${table}-${all().length + i + 1}`,
            active: true,
            plan: null,
            created_at: "2026-11-13T00:00:00Z",
            updated_at: "2026-11-13T00:00:00Z",
            ...r,
          }));
          all().push(...made);
          return made;
        }
        if (patch) {
          const hit = matching();
          for (const r of hit) Object.assign(r, patch);
          return hit;
        }
        if (remove) {
          const hit = matching();
          tables[table] = all().filter((r) => !hit.includes(r));
          return hit;
        }
        return matching();
      };
      const chain = {
        select: () => chain,
        order: () => chain,
        eq: (c: string, v: unknown) => (filters.push([c, v]), chain),
        in: (c: string, vs: unknown[]) => (inFilters.push([c, vs]), chain),
        delete: () => ((remove = true), chain),
        insert: (r: Row | Row[]) => ((insertRows = Array.isArray(r) ? r : [r]), chain),
        update: (p: Row) => ((patch = p), chain),
        single: async () => ({ data: run()[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve: (v: { data: Row[]; error: null }) => void) =>
          resolve({ data: run(), error: null }),
      };
      return chain;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

const NOW = new Date("2026-11-13T12:00:00Z");
const PLAN = "11111111-1111-4111-8111-111111111111";
const OTHER_PLAN = "22222222-2222-4222-8222-222222222222";

const promo = (over: Row = {}): Row => ({
  id: "promo1",
  coach_id: "c1",
  code: "SUMMER10",
  discount_type: "percent",
  discount_value: "10.00",
  plan_id: null,
  plan: null,
  max_redemptions: 50,
  expires_at: null,
  active: true,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  ...over,
});
const use = (buyer: string, status = "fulfilled", amount = 2249, paid = true): Row => ({
  promo_code_id: "promo1",
  buyer_user_id: buyer,
  status,
  amount_cents: amount,
  payment_status: paid ? "paid" : "payment_due",
});
const args = (over: Partial<Parameters<typeof checkPromoForPlan>[1]> = {}) => ({
  coachId: "c1",
  planId: PLAN,
  originalAmountCents: 2499,
  buyerUserId: "u",
  code: "summer10",
  ...over,
});
const check = (
  tables: Record<string, Row[]>,
  over: Partial<Parameters<typeof checkPromoForPlan>[1]> = {},
) => checkPromoForPlan(fakeAdmin(tables), args(over), NOW);

describe("discountedCents", () => {
  it("rounds a percent off to the cent, never goes below 0, and is 0 when free", () => {
    expect(discountedCents(2499, "percent", 15)).toBe(2124);
    expect(discountedCents(2499, "percent", 100)).toBe(0);
    expect(discountedCents(2499, "fixed", 5)).toBe(1999);
    expect(discountedCents(2499, "fixed", 50)).toBe(0);
    expect(discountedCents(2499, "free", null)).toBe(0);
  });
});

describe("checkPromoForPlan", () => {
  it("applies a code typed in any case", async () => {
    expect(await check({ coach_promo_codes: [promo()], plan_purchases: [] })).toEqual({
      state: "valid",
      promo: {
        promoCodeId: "promo1",
        code: "SUMMER10",
        discountType: "percent",
        discountValue: 10,
        originalAmountCents: 2499,
        discountCents: 250,
        amountCents: 2249,
      },
    });
  });

  it("makes the plan free with a Free code", async () => {
    const res = await check({
      coach_promo_codes: [promo({ discount_type: "free", discount_value: null })],
      plan_purchases: [],
    });
    expect(res).toMatchObject({ state: "valid", promo: { amountCents: 0, discountCents: 2499 } });
  });

  it("calls an unknown or disabled code invalid", async () => {
    for (const tables of [
      { coach_promo_codes: [promo({ coach_id: "someone-else" })] },
      { coach_promo_codes: [promo({ active: false })] },
    ]) {
      expect(await check(tables)).toMatchObject({ state: "invalid" });
    }
  });

  it("refuses an expired code, or one for another plan or a free plan", async () => {
    expect(
      await check({ coach_promo_codes: [promo({ expires_at: "2026-11-13T00:00:00Z" })] }),
    ).toMatchObject({ state: "expired", message: "This promo code has expired." });
    expect(await check({ coach_promo_codes: [promo({ plan_id: OTHER_PLAN })] })).toMatchObject({
      state: "wrong_plan",
    });
    expect(await check({ coach_promo_codes: [promo()] }, { originalAmountCents: 0 })).toMatchObject(
      { state: "wrong_plan", message: "This plan is already free." },
    );
  });

  it("counts delivered uses against max uses, and lets each buyer use it once", async () => {
    expect(
      await check({
        coach_promo_codes: [promo({ max_redemptions: 2 })],
        plan_purchases: [use("a"), use("b", "restricted")],
      }),
    ).toMatchObject({ state: "exhausted" });
    expect(await check({ coach_promo_codes: [promo()], plan_purchases: [use("u")] })).toMatchObject(
      { state: "already_used" },
    );
    // An open or abandoned checkout isn't a use.
    expect(
      await check({
        coach_promo_codes: [promo()],
        plan_purchases: [use("u", "pending"), use("u", "canceled")],
      }),
    ).toMatchObject({ state: "valid" });
  });

  it("refuses a discount that leaves less than Stripe's $0.50 but more than free", async () => {
    expect(
      await check({
        coach_promo_codes: [promo({ discount_type: "fixed", discount_value: "24.70" })],
        plan_purchases: [],
      }),
    ).toMatchObject({ state: "below_minimum" });
  });
});

describe("resolvePromoForPlan", () => {
  it("turns a refusal into the checkout error", async () => {
    await expect(
      resolvePromoForPlan(fakeAdmin({ coach_promo_codes: [] }), args(), NOW),
    ).rejects.toMatchObject({ status: 404, code: "promo_code_invalid" });
    await expect(
      resolvePromoForPlan(
        fakeAdmin({
          coach_promo_codes: [promo({ max_redemptions: 1 })],
          plan_purchases: [use("a")],
        }),
        args(),
        NOW,
      ),
    ).rejects.toMatchObject({ status: 422, code: "promo_code_used_up" });
  });
});

describe("coach promo codes", () => {
  const coach = { id: "c1", user_id: "u-coach" };
  const ctx = (tables: Record<string, Row[]>) => ({ userId: "u-coach", admin: fakeAdmin(tables) });

  it("saves a new code upper-case, for one of the coach's plans", async () => {
    const tables: Record<string, Row[]> = {
      coach_profiles: [coach],
      plans: [{ id: PLAN, coach_id: "c1" }],
      coach_promo_codes: [],
    };
    const res = await createCoachPromoCode(
      ctx(tables),
      createPromoCodeInput.parse({
        code: " spring-25 ",
        discountType: "fixed",
        discountValue: 5,
        planId: PLAN,
        maxRedemptions: 50,
      }),
      NOW,
    );
    expect(res).toMatchObject({
      code: "SPRING-25",
      discountType: "fixed",
      discountValue: 5,
      maxRedemptions: 50,
      redemptionCount: 0,
      revenueCents: 0,
      expiresAt: null,
      isActive: true,
      state: "active",
    });
    expect(tables.coach_promo_codes[0]).toMatchObject({ plan_id: PLAN });
  });

  it("saves a Free code with no value", async () => {
    const tables: Record<string, Row[]> = { coach_profiles: [coach], coach_promo_codes: [] };
    const res = await createCoachPromoCode(
      ctx(tables),
      createPromoCodeInput.parse({
        code: "GIVEAWAY",
        discountType: "free",
        discountValue: 20,
        maxRedemptions: 10,
      }),
      NOW,
    );
    expect(res).toMatchObject({ discountType: "free", discountValue: null });
  });

  it("rejects a bad code, max uses out of 1–999, a missing or too-big value, a past end, or another coach's plan", async () => {
    const base = { code: "HALF", discountType: "percent", discountValue: 10, maxRedemptions: 50 };
    expect(createPromoCodeInput.safeParse({ ...base, code: "TWO WORDS" }).success).toBe(false);
    expect(createPromoCodeInput.safeParse({ ...base, maxRedemptions: 1000 }).success).toBe(false);
    expect(createPromoCodeInput.safeParse({ ...base, maxRedemptions: undefined }).success).toBe(
      false,
    );
    for (const input of [
      { ...base, discountValue: 150 },
      { ...base, discountValue: undefined },
      { ...base, expiresAt: "2026-11-01T00:00:00Z" },
      { ...base, planId: OTHER_PLAN },
    ]) {
      await expect(
        createCoachPromoCode(
          ctx({ coach_profiles: [coach], plans: [{ id: OTHER_PLAN, coach_id: "c2" }] }),
          createPromoCodeInput.parse(input),
          NOW,
        ),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it("lists codes with uses, revenue from paid purchases, and Active / Ended", async () => {
    const res = await listCoachPromoCodes(
      ctx({
        coach_profiles: [coach],
        coach_promo_codes: [
          promo({ max_redemptions: 3, plan: { id: PLAN, title: "Edge Control" }, plan_id: PLAN }),
          promo({ id: "promo2", code: "OLD", active: false }),
        ],
        plan_purchases: [use("a"), use("b", "fulfilled", 2249, false), use("c", "pending")],
      }),
      NOW,
    );
    expect(res.items[0]).toMatchObject({
      plan: { id: PLAN, title: "Edge Control" },
      redemptionCount: 2,
      revenueCents: 2249,
      isActive: true,
      state: "active",
    });
    expect(res.items[1]).toMatchObject({ isActive: false, state: "disabled" });
  });

  it("gets one code, and counts usable ones for the dashboard", async () => {
    const tables = {
      coach_profiles: [coach],
      coach_promo_codes: [
        promo(),
        promo({ id: "promo2", code: "DONE", max_redemptions: 1 }),
        promo({ id: "promo3", code: "LATE", expires_at: "2026-11-01T00:00:00Z" }),
      ],
      plan_purchases: [{ ...use("a"), promo_code_id: "promo2" }],
    };
    expect(await getCoachPromoCode(ctx(tables), "promo2")).toMatchObject({
      redemptionCount: 1,
      state: "used_up",
    });
    expect(await promoCodeCounts(fakeAdmin(tables), "c1", NOW)).toEqual({ active: 1, total: 3 });
  });

  it("disables a code, clears the value when switched to Free, and only touches the coach's own", async () => {
    const tables = { coach_profiles: [coach], coach_promo_codes: [promo()] };
    expect(
      await updateCoachPromoCode(
        ctx(tables),
        "promo1",
        updatePromoCodeInput.parse({ active: false }),
        NOW,
      ),
    ).toMatchObject({ active: false, isActive: false, state: "disabled" });
    expect(
      await updateCoachPromoCode(
        ctx(tables),
        "promo1",
        updatePromoCodeInput.parse({ discountType: "free" }),
        NOW,
      ),
    ).toMatchObject({ discountType: "free", discountValue: null });
    await expect(
      updateCoachPromoCode(
        ctx({
          coach_profiles: [coach],
          coach_promo_codes: [promo({ discount_type: "free", discount_value: null })],
        }),
        "promo1",
        updatePromoCodeInput.parse({ discountType: "percent" }),
        NOW,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      updateCoachPromoCode(
        ctx({ coach_profiles: [coach], coach_promo_codes: [promo({ coach_id: "c2" })] }),
        "promo1",
        updatePromoCodeInput.parse({ active: false }),
        NOW,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("deletes the coach's code", async () => {
    const tables: Record<string, Row[]> = { coach_profiles: [coach], coach_promo_codes: [promo()] };
    expect(await deleteCoachPromoCode(ctx(tables), "promo1")).toEqual({ ok: true });
    expect(tables.coach_promo_codes).toHaveLength(0);
  });
});
