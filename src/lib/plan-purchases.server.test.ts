import { describe, expect, it } from "bun:test";
import {
  ageOn,
  athleteMayPurchase,
  fulfillPurchase,
  listCoachSales,
  listMyPlanPurchases,
  payPlanPurchase,
  resolvePurchaseAthlete,
  restrictPlanPurchase,
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

  it("delivers right away without paying while the coach isn't on Stripe yet", async () => {
    const tables: Record<string, Row[]> = {
      plans: [listing({ ...readyCoach, stripe_connect_payouts_enabled: false })],
      athletes: [adultAthlete],
      plan_purchases: [],
      plan_moves: [],
    };
    const admin = fakeAdmin(tables);
    const { stripe, calls } = fakeStripe();
    const res = await startPlanCheckout(
      { userId: "u", admin, stripe },
      "p1",
      {},
      { origin: "https://gradus.test" },
    );
    expect(res.checkoutUrl).toBeNull();
    expect(res.purchase).toMatchObject({
      status: "fulfilled",
      paymentStatus: "awaiting_coach_setup",
      paymentDueAt: null,
      overdue: false,
    });
    expect(res.purchase.copiedPlanId).not.toBeNull();
    expect(calls.some((c) => c[0] === "sessions.create")).toBe(false);
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
          payment_status: "payment_due",
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
    expect(done).toMatchObject({ status: "fulfilled", payment_status: "paid" });
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

describe("pay later", () => {
  const NOW = new Date("2026-11-20T12:00:00Z");
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
  const sale = (over: Row = {}): Row => ({
    id: "pur1",
    plan_id: "p1",
    coach_id: "c-seller",
    buyer_user_id: "u",
    athlete_id: "a1",
    copied_plan_id: "copy1",
    amount_cents: 2499,
    currency: "usd",
    status: "fulfilled",
    payment_status: "payment_due",
    payment_due_at: daysAgo(1),
    paid_at: null,
    platform_fee_cents: null,
    stripe_fee_cents: null,
    coach_payout_cents: null,
    stripe_checkout_session_id: null,
    created_at: daysAgo(5),
    ...over,
  });
  const notReady = { ...readyCoach, user_id: "u-seller", stripe_connect_payouts_enabled: false };

  it("won't take payment while the coach still isn't on Stripe", async () => {
    const admin = fakeAdmin({
      plan_purchases: [sale({ payment_status: "awaiting_coach_setup", payment_due_at: null })],
      coach_profiles: [notReady],
    });
    await expect(
      payPlanPurchase({ userId: "u", admin, stripe: fakeStripe().stripe }, "pur1", {
        origin: "https://gradus.test",
      }),
    ).rejects.toMatchObject({ status: 409, code: "coach_not_ready" });
  });

  it("becomes due once the coach is on Stripe, and opens a checkout for the price", async () => {
    const tables: Record<string, Row[]> = {
      plan_purchases: [sale({ payment_status: "awaiting_coach_setup", payment_due_at: null })],
      coach_profiles: [readyCoach],
      plans: [{ id: "p1", title: "Edge Control", description: null }],
    };
    const admin = fakeAdmin(tables);
    const { stripe, calls } = fakeStripe();
    const res = await payPlanPurchase({ userId: "u", admin, stripe }, "pur1", {
      origin: "https://gradus.test",
    });
    expect(res.checkoutUrl).toBe("https://checkout.stripe.test/cs_1");
    expect(res.purchase.paymentStatus).toBe("payment_due");
    expect(tables.plan_purchases[0].payment_due_at).not.toBeNull();
    expect(calls.find((c) => c[0] === "sessions.create")![1]).toMatchObject({
      line_items: [{ price_data: { unit_amount: 2499, product_data: { name: "Edge Control" } } }],
    });
  });

  it("gives the coach received and pending totals, and flags a sale 3 days unpaid", async () => {
    const admin = fakeAdmin({
      coach_profiles: [{ ...readyCoach, user_id: "u-seller" }],
      plan_purchases: [
        sale({
          id: "paid1",
          payment_status: "paid",
          coach_payout_cents: 2322,
          paid_at: daysAgo(4),
        }),
        sale({ id: "due1", payment_due_at: daysAgo(1) }),
        sale({ id: "late1", payment_due_at: daysAgo(3) }),
      ],
      plans: [{ id: "p1", title: "Edge Control" }],
      athletes: [{ id: "a1", first_name: "Jamie", last_name: "Gilmore" }],
    });
    const res = await listCoachSales({ userId: "u-seller", admin }, {}, NOW);
    expect(res.totals).toEqual({ receivedCents: 2322, pendingCents: 4998, overdueCount: 1 });
    const late = res.items.find((i) => i.id === "late1")!;
    expect(late).toMatchObject({
      overdue: true,
      canRestrict: true,
      athleteName: "Jamie G.",
      planTitle: "Edge Control",
    });
    expect(res.items.find((i) => i.id === "due1")!.canRestrict).toBe(false);

    const pending = await listCoachSales(
      { userId: "u-seller", admin },
      { paymentStatus: "pending" },
      NOW,
    );
    expect(pending.items.map((i) => i.id).sort()).toEqual(["due1", "late1"]);
  });

  it("lists a buyer's own purchases with their payment status", async () => {
    const admin = fakeAdmin({
      plan_purchases: [
        sale({ id: "mine" }),
        sale({ id: "theirs", buyer_user_id: "someone-else" }),
        sale({ id: "abandoned", status: "pending" }),
      ],
      coach_profiles: [{ ...readyCoach, first_name: "Tami", last_name: "Taylor" }],
      plans: [{ id: "p1", title: "Edge Control" }],
      athletes: [{ id: "a1", first_name: "Jamie", last_name: "Gilmore" }],
    });
    const res = await listMyPlanPurchases({ userId: "u", admin }, {}, NOW);
    expect(res.items.map((i) => i.id)).toEqual(["mine"]);
    expect(res.items[0]).toMatchObject({ paymentStatus: "payment_due", coachName: "Tami Taylor" });
  });

  it("lets the coach restrict only an overdue buyer, and removes their copy", async () => {
    const tables: Record<string, Row[]> = {
      coach_profiles: [{ ...readyCoach, user_id: "u-seller" }],
      plan_purchases: [sale({ payment_due_at: daysAgo(1) })],
      plans: [{ id: "copy1" }],
      plan_moves: [{ plan_id: "copy1" }],
    };
    const admin = fakeAdmin(tables);
    await expect(
      restrictPlanPurchase({ userId: "u-seller", admin }, "pur1", NOW),
    ).rejects.toMatchObject({
      status: 409,
      code: "not_overdue",
    });

    tables.plan_purchases[0].payment_due_at = daysAgo(3);
    const res = await restrictPlanPurchase({ userId: "u-seller", admin }, "pur1", NOW);
    expect(res).toMatchObject({ status: "restricted", copiedPlanId: null });
    expect(tables.plans).toEqual([]);
    expect(tables.plan_moves).toEqual([]);
  });

  it("won't let another coach restrict the sale", async () => {
    const admin = fakeAdmin({
      coach_profiles: [{ id: "c-other", user_id: "u-other" }],
      plan_purchases: [sale({ payment_due_at: daysAgo(10) })],
    });
    await expect(
      restrictPlanPurchase({ userId: "u-other", admin }, "pur1", NOW),
    ).rejects.toMatchObject({
      status: 404,
    });
  });
});
