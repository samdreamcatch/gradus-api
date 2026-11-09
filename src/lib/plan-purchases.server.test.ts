import { describe, expect, it } from "bun:test";
import {
  ageOn,
  athleteMayPurchase,
  fulfillPurchase,
  resolvePurchaseAthlete,
  splitPayment,
  startPlanCheckout,
  type PurchaseStripe,
} from "./plan-purchases.server";

type Row = Record<string, unknown>;

/**
 * A small table store: `.eq()`/`.in()` filter rows; `insert`/`update` change
 * them; `.single()`/`.maybeSingle()` return the first match. Embedded `coach`
 * objects ride on the plan row itself.
 */
function fakeAdmin(tables: Record<string, Row[]>, opts: { email?: string } = {}) {
  const admin = {
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: opts.email ?? "buyer@test.dev" } } }),
      },
    },
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      let insertRows: Row[] | null = null;
      let patch: Row | null = null;
      const all = () => (tables[table] ??= []);
      const matching = () => all().filter((r) => filters.every(([c, v]) => r[c] === v));
      const run = () => {
        if (insertRows) {
          const made = insertRows.map((r, i) => ({
            id: `${table}-${all().length + i + 1}`,
            status: "pending",
            copied_plan_id: null,
            stripe_checkout_session_id: null,
            currency: "usd",
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
        return matching();
      };
      const chain = {
        select: () => chain,
        order: () => chain,
        eq: (c: string, v: unknown) => (filters.push([c, v]), chain),
        in: () => chain,
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

const readyCoach = {
  id: "c-seller",
  user_id: "u-seller",
  subscription_tier: "coach_pro",
  organization_id: null,
  stripe_connect_account_id: "acct_seller",
  stripe_connect_charges_enabled: true,
  stripe_connect_payouts_enabled: true,
};
const listing = (coach: Row = readyCoach, price = 24.99) => ({
  id: "p1",
  title: "Edge Control",
  description: "Edges first.",
  price,
  status: "active",
  feedback_scope: "plan",
  coach,
});
const TODAY = new Date("2026-11-10T12:00:00Z");

function fakeStripe() {
  const calls: unknown[][] = [];
  const stripe = {
    checkout: {
      sessions: {
        create: async (params: unknown, opts: unknown) => {
          calls.push(["sessions.create", params, opts]);
          return { id: "cs_1", url: "https://checkout.stripe.test/cs_1" };
        },
        retrieve: async () => ({
          id: "cs_1",
          status: "complete",
          payment_status: "paid",
          payment_intent: "pi_1",
        }),
      },
    },
    paymentIntents: {
      retrieve: async () => ({
        id: "pi_1",
        latest_charge: { id: "ch_1", balance_transaction: { fee: 102 } },
      }),
    },
    transfers: {
      create: async (params: unknown, opts: unknown) => {
        calls.push(["transfers.create", params, opts]);
        return { id: "tr_1" };
      },
    },
  } as unknown as PurchaseStripe;
  return { stripe, calls };
}

describe("splitPayment", () => {
  it("keeps 3% for Gradus and takes Stripe's fee out of the coach's share", () => {
    // $24.99, Stripe fee $1.02: Gradus $0.75, coach $23.22.
    expect(splitPayment(2499, 102)).toEqual({ platformFeeCents: 75, coachPayoutCents: 2322 });
    expect(splitPayment(100, 200)).toEqual({ platformFeeCents: 3, coachPayoutCents: 0 });
  });
});

describe("ageOn", () => {
  it("counts a birthday only once it has passed", () => {
    expect(ageOn("2013-11-10", TODAY)).toBe(13);
    expect(ageOn("2013-11-11", TODAY)).toBe(12);
  });
});

describe("athleteMayPurchase", () => {
  it("is true only for an active athlete of 13 or older", () => {
    expect(athleteMayPurchase({ account_state: "active", birthdate: "2010-04-12" }, TODAY)).toBe(
      true,
    );
    expect(
      athleteMayPurchase({ account_state: "provisional", birthdate: "2010-04-12" }, TODAY),
    ).toBe(false);
    expect(athleteMayPurchase({ account_state: "active", birthdate: "2015-01-01" }, TODAY)).toBe(
      false,
    );
    expect(athleteMayPurchase({ account_state: "active", birthdate: null }, TODAY)).toBe(false);
  });
});

describe("resolvePurchaseAthlete", () => {
  const athlete = (extra: Row) => ({ id: "a1", user_id: "u", account_state: "active", ...extra });

  it("lets an active athlete of 13 or older buy for themselves", async () => {
    const admin = fakeAdmin({ athletes: [athlete({ birthdate: "2010-01-01" })] });
    expect(await resolvePurchaseAthlete(admin, "u", undefined, TODAY)).toBe("a1");
  });

  it("sends a provisional minor, an under-13, or an athlete with no birthdate to their parent", async () => {
    for (const extra of [
      { birthdate: "2010-01-01", account_state: "provisional" },
      { birthdate: "2015-01-01" },
      { birthdate: null },
    ]) {
      const admin = fakeAdmin({ athletes: [athlete(extra)] });
      await expect(resolvePurchaseAthlete(admin, "u", undefined, TODAY)).rejects.toMatchObject({
        status: 403,
        code: "parent_required",
      });
    }
  });

  it("needs a parent to name their own child", async () => {
    const admin = fakeAdmin({ parent_profiles: [{ id: "par1", user_id: "u" }], athletes: [] });
    await expect(resolvePurchaseAthlete(admin, "u", undefined, TODAY)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("refuses a coach", async () => {
    const admin = fakeAdmin({ athletes: [] });
    await expect(resolvePurchaseAthlete(admin, "u", undefined, TODAY)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("startPlanCheckout", () => {
  const adultAthlete = { id: "a1", user_id: "u", account_state: "active", birthdate: "2000-01-01" };

  it("refuses every buyer while the coach can't be paid out", async () => {
    const admin = fakeAdmin({
      plans: [listing({ ...readyCoach, stripe_connect_payouts_enabled: false })],
      athletes: [adultAthlete],
    });
    await expect(
      startPlanCheckout(
        { userId: "u", admin, stripe: fakeStripe().stripe },
        "p1",
        {},
        { origin: "https://gradus.test" },
      ),
    ).rejects.toMatchObject({ status: 409, code: "seller_not_ready" });
  });

  it("records a pending purchase and opens Stripe Checkout for the plan's price", async () => {
    const tables = { plans: [listing()], athletes: [adultAthlete], plan_purchases: [] as Row[] };
    const admin = fakeAdmin(tables);
    const { stripe, calls } = fakeStripe();
    const res = await startPlanCheckout(
      { userId: "u", admin, stripe },
      "p1",
      {},
      { origin: "https://gradus.test" },
    );
    expect(res.checkoutUrl).toBe("https://checkout.stripe.test/cs_1");
    expect(res.purchase).toMatchObject({
      status: "pending",
      planId: "p1",
      athleteId: "a1",
      amountCents: 2499,
    });
    const create = calls.find((c) => c[0] === "sessions.create")!;
    expect(create[1]).toMatchObject({
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 2499 } }],
      success_url: `https://gradus.test/purchase/complete?purchase=${res.purchase.id}`,
    });
    expect(tables.plan_purchases[0]).toMatchObject({ stripe_checkout_session_id: "cs_1" });
  });

  it("refuses the coach their own plan", async () => {
    const admin = fakeAdmin({ plans: [listing()], athletes: [] });
    await expect(
      startPlanCheckout(
        { userId: "u-seller", admin, stripe: fakeStripe().stripe },
        "p1",
        {},
        { origin: "https://gradus.test" },
      ),
    ).rejects.toMatchObject({ status: 409, code: "own_plan" });
  });
});

describe("fulfillPurchase", () => {
  it("transfers the coach's share, copies the plan, and only does it once", async () => {
    const tables: Record<string, Row[]> = {
      plan_purchases: [
        {
          id: "pur1",
          plan_id: "p1",
          coach_id: "c-seller",
          buyer_user_id: "u",
          athlete_id: "a1",
          copied_plan_id: null,
          amount_cents: 2499,
          currency: "usd",
          status: "pending",
          stripe_checkout_session_id: "cs_1",
        },
      ],
      coach_profiles: [{ id: "c-seller", stripe_connect_account_id: "acct_seller" }],
      plans: [
        { id: "p1", title: "Edge Control", description: "Edges first.", feedback_scope: "plan" },
      ],
      plan_moves: [
        {
          plan_id: "p1",
          position: 0,
          name: "Crossovers",
          description: "",
          cue: "",
          why: "",
          target_kind: "reps",
          target_value: 10,
        },
      ],
    };
    const admin = fakeAdmin(tables);
    const { stripe, calls } = fakeStripe();

    const done = await fulfillPurchase(admin, stripe, "pur1");
    expect(done).toMatchObject({ status: "fulfilled" });
    expect(tables.plan_purchases[0]).toMatchObject({
      platform_fee_cents: 75,
      stripe_fee_cents: 102,
      coach_payout_cents: 2322,
      stripe_transfer_id: "tr_1",
    });
    expect(calls.find((c) => c[0] === "transfers.create")).toEqual([
      "transfers.create",
      {
        amount: 2322,
        currency: "usd",
        destination: "acct_seller",
        source_transaction: "ch_1",
        transfer_group: "purchase_pur1",
        metadata: { purchase_id: "pur1" },
      },
      { idempotencyKey: "gradus-purchase-transfer-pur1" },
    ]);
    const copy = tables.plans.find((p) => p.source === "athlete")!;
    expect(copy).toMatchObject({
      kind: "plan",
      coach_id: null,
      athlete_id: "a1",
      status: "active",
      title: "Edge Control",
    });
    expect(tables.plan_moves.filter((m) => m.plan_id === copy.id)).toHaveLength(1);

    await fulfillPurchase(admin, stripe, "pur1");
    expect(calls.filter((c) => c[0] === "transfers.create")).toHaveLength(1);
  });
});
