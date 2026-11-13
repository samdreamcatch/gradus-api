import { describe, expect, it } from "bun:test";
import {
  createCoachPromoCode,
  createPromoCodeInput,
  deleteCoachPromoCode,
  discountedCents,
  listCoachPromoCodes,
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
  plan_ids: null,
  max_redemptions: null,
  max_per_user: 1,
  starts_at: null,
  expires_at: null,
  active: true,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  ...over,
});
const use = (buyer: string, status = "fulfilled"): Row => ({
  promo_code_id: "promo1",
  buyer_user_id: buyer,
  status,
});
const apply = (
  tables: Record<string, Row[]>,
  over: Partial<Parameters<typeof resolvePromoForPlan>[1]> = {},
) =>
  resolvePromoForPlan(
    fakeAdmin(tables),
    {
      coachId: "c1",
      planId: PLAN,
      originalAmountCents: 2499,
      buyerUserId: "u",
      code: "summer10",
      ...over,
    },
    NOW,
  );

describe("discountedCents", () => {
  it("rounds a percent off to the cent and never goes below 0", () => {
    expect(discountedCents(2499, "percent", 15)).toBe(2124);
    expect(discountedCents(2499, "percent", 100)).toBe(0);
    expect(discountedCents(2499, "fixed", 5)).toBe(1999);
    expect(discountedCents(2499, "fixed", 50)).toBe(0);
  });
});

describe("resolvePromoForPlan", () => {
  it("applies a code typed in any case", async () => {
    expect(await apply({ coach_promo_codes: [promo()], plan_purchases: [] })).toEqual({
      promoCodeId: "promo1",
      code: "SUMMER10",
      discountType: "percent",
      discountValue: 10,
      originalAmountCents: 2499,
      discountCents: 250,
      amountCents: 2249,
    });
  });

  it("makes the plan free at 100% off", async () => {
    const res = await apply({
      coach_promo_codes: [promo({ discount_value: "100.00" })],
      plan_purchases: [],
    });
    expect(res.amountCents).toBe(0);
  });

  it("treats an unknown, paused, or not-yet-started code as invalid", async () => {
    for (const tables of [
      { coach_promo_codes: [promo({ coach_id: "someone-else" })] },
      { coach_promo_codes: [promo({ active: false })] },
      { coach_promo_codes: [promo({ starts_at: "2026-12-01T00:00:00Z" })] },
    ]) {
      await expect(apply(tables)).rejects.toMatchObject({
        status: 404,
        code: "promo_code_invalid",
      });
    }
  });

  it("refuses an expired code", async () => {
    await expect(
      apply({ coach_promo_codes: [promo({ expires_at: "2026-11-13T00:00:00Z" })] }),
    ).rejects.toMatchObject({ status: 422, code: "promo_code_expired" });
  });

  it("refuses a code for other plans, or on a free plan", async () => {
    await expect(
      apply({ coach_promo_codes: [promo({ plan_ids: [OTHER_PLAN] })] }),
    ).rejects.toMatchObject({ code: "promo_code_not_applicable" });
    await expect(
      apply({ coach_promo_codes: [promo()] }, { originalAmountCents: 0 }),
    ).rejects.toMatchObject({ code: "promo_code_not_applicable" });
  });

  it("counts delivered uses against the total and per-buyer limits, not open checkouts", async () => {
    await expect(
      apply({
        coach_promo_codes: [promo({ max_redemptions: 2, max_per_user: null })],
        plan_purchases: [use("a"), use("b", "restricted")],
      }),
    ).rejects.toMatchObject({ code: "promo_code_used_up" });
    await expect(
      apply({ coach_promo_codes: [promo()], plan_purchases: [use("u")] }),
    ).rejects.toMatchObject({ code: "promo_code_already_used" });
    const res = await apply({
      coach_promo_codes: [promo()],
      plan_purchases: [use("u", "pending"), use("u", "canceled")],
    });
    expect(res.amountCents).toBe(2249);
  });

  it("refuses a discount that leaves less than Stripe's $0.50 but more than free", async () => {
    await expect(
      apply({
        coach_promo_codes: [promo({ discount_type: "fixed", discount_value: "24.70" })],
        plan_purchases: [],
      }),
    ).rejects.toMatchObject({ code: "promo_code_below_minimum" });
  });
});

describe("coach promo code CRUD", () => {
  const coach = { id: "c1", user_id: "u-coach" };
  const ctx = (tables: Record<string, Row[]>) => ({ userId: "u-coach", admin: fakeAdmin(tables) });

  it("saves a new code upper-case with its defaults", async () => {
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
        planIds: [PLAN],
      }),
    );
    expect(res).toMatchObject({
      code: "SPRING-25",
      discountType: "fixed",
      discountValue: 5,
      planIds: [PLAN],
      maxPerUser: 1,
      maxRedemptions: null,
      redemptionCount: 0,
      active: true,
      state: "active",
    });
  });

  it("rejects a code with spaces, and a percent over 100", async () => {
    expect(
      createPromoCodeInput.safeParse({ code: "TWO WORDS", discountType: "fixed", discountValue: 5 })
        .success,
    ).toBe(false);
    await expect(
      createCoachPromoCode(
        ctx({ coach_profiles: [coach] }),
        createPromoCodeInput.parse({ code: "HALF", discountType: "percent", discountValue: 150 }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("only applies a code to the coach's own plans", async () => {
    await expect(
      createCoachPromoCode(
        ctx({ coach_profiles: [coach], plans: [{ id: OTHER_PLAN, coach_id: "c2" }] }),
        createPromoCodeInput.parse({
          code: "MINE",
          discountType: "percent",
          discountValue: 10,
          planIds: [OTHER_PLAN],
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("lists codes with their delivered uses and state", async () => {
    const res = await listCoachPromoCodes(
      ctx({
        coach_profiles: [coach],
        coach_promo_codes: [promo({ max_redemptions: 2 })],
        plan_purchases: [use("a"), use("b"), use("c", "pending")],
      }),
    );
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ redemptionCount: 2, state: "used_up" });
  });

  it("checks a change against the saved code, and only the coach's own", async () => {
    const tables = {
      coach_profiles: [coach],
      coach_promo_codes: [promo({ discount_type: "fixed", discount_value: "150.00" })],
    };
    await expect(
      updateCoachPromoCode(
        ctx(tables),
        "promo1",
        updatePromoCodeInput.parse({ discountType: "percent" }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    const paused = await updateCoachPromoCode(
      ctx(tables),
      "promo1",
      updatePromoCodeInput.parse({ active: false }),
    );
    expect(paused).toMatchObject({ active: false, state: "paused" });

    await expect(
      updateCoachPromoCode(
        ctx({ coach_profiles: [coach], coach_promo_codes: [promo({ coach_id: "c2" })] }),
        "promo1",
        updatePromoCodeInput.parse({ active: false }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("deletes the coach's code", async () => {
    const tables: Record<string, Row[]> = { coach_profiles: [coach], coach_promo_codes: [promo()] };
    expect(await deleteCoachPromoCode(ctx(tables), "promo1")).toEqual({ ok: true });
    expect(tables.coach_promo_codes).toHaveLength(0);
  });
});
