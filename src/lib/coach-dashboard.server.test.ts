import { describe, expect, it } from "bun:test";
import { getCoachDashboard, recordPlanView } from "./coach-dashboard.server";

type Row = Record<string, unknown>;

/** Rows per table; eq/in/is/gte filter, upsert honours ignoreDuplicates on its conflict columns. */
function fakeAdmin(tables: Record<string, Row[]>) {
  const admin = {
    from: (table: string) => {
      const all = () => (tables[table] ??= []);
      const tests: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      let upsert: { row: Row; keys: string[] } | null = null;
      let countOnly = false;
      const matching = () => all().filter((r) => tests.every((t) => t(r)));
      const run = () => {
        if (upsert) {
          const { row, keys } = upsert;
          if (all().some((r) => keys.every((k) => r[k] === row[k]))) return [];
          const made = { id: `${table}-${all().length + 1}`, ...row };
          all().push(made);
          return [made];
        }
        if (patch) {
          const hit = matching();
          for (const r of hit) Object.assign(r, patch);
          return hit;
        }
        return matching();
      };
      const chain = {
        select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) countOnly = true;
          return chain;
        },
        order: () => chain,
        eq: (c: string, v: unknown) => (tests.push((r) => r[c] === v), chain),
        is: (c: string, v: unknown) => (tests.push((r) => (r[c] ?? null) === v), chain),
        in: (c: string, vs: unknown[]) => (tests.push((r) => vs.includes(r[c])), chain),
        gte: (c: string, v: string) => (tests.push((r) => String(r[c]) >= v), chain),
        or: (f: string) => (
          tests.push((r) =>
            f.split(",").some((cond) => {
              const [col, op, val] = cond.split(".");
              return op === "is" ? (r[col] ?? null) === null : String(r[col]) === val;
            }),
          ),
          chain
        ),
        gt: (c: string, v: number) => (tests.push((r) => Number(r[c] ?? 0) > v), chain),
        update: (p: Row) => ((patch = p), chain),
        upsert: (row: Row, opts: { onConflict: string }) => (
          (upsert = { row, keys: opts.onConflict.split(",") }),
          chain
        ),
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => {
          const rows = run();
          resolve(countOnly ? { count: rows.length, error: null } : { data: rows, error: null });
        },
      };
      return chain;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

const TODAY = new Date("2026-11-11T12:00:00Z");

describe("recordPlanView", () => {
  const plan = { id: "p1", status: "active", view_count: 0, coach: { user_id: "u-coach" } };

  it("counts a viewer once a day and keeps the plan's total", async () => {
    const tables: Record<string, Row[]> = { plans: [{ ...plan }], plan_views: [] };
    const admin = fakeAdmin(tables);
    expect(await recordPlanView({ userId: "u-buyer", admin }, "p1", TODAY)).toEqual({
      counted: true,
      viewCount: 1,
    });
    expect(await recordPlanView({ userId: "u-buyer", admin }, "p1", TODAY)).toMatchObject({
      counted: false,
    });
    await recordPlanView({ userId: "u-other", admin }, "p1", TODAY);
    expect(tables.plans[0].view_count).toBe(2);
  });

  it("never counts the plan's own coach", async () => {
    const tables: Record<string, Row[]> = { plans: [{ ...plan }], plan_views: [] };
    const res = await recordPlanView({ userId: "u-coach", admin: fakeAdmin(tables) }, "p1", TODAY);
    expect(res.counted).toBe(false);
    expect(tables.plan_views).toEqual([]);
  });
});

describe("getCoachDashboard", () => {
  const sale = (over: Row): Row => ({
    plan_id: "p1",
    coach_id: "c1",
    buyer_user_id: "u-buyer",
    athlete_id: "a1",
    copied_plan_id: "copy",
    amount_cents: 2499,
    currency: "usd",
    status: "fulfilled",
    payment_due_at: null,
    paid_at: null,
    platform_fee_cents: null,
    stripe_fee_cents: null,
    coach_payout_cents: null,
    stripe_checkout_session_id: null,
    ...over,
  });

  it("adds up sales, earnings, pending, views, conversion and rating from real rows", async () => {
    const admin = fakeAdmin({
      coach_profiles: [{ id: "c1", user_id: "u-coach", stripe_connect_account_id: null }],
      plans: [
        {
          id: "p1",
          title: "Edge Control",
          price: 24.99,
          status: "active",
          kind: "plan",
          athlete_id: null,
          coach_id: "c1",
          view_count: 4,
          rating_avg: "5.00",
          rating_count: 1,
          created_at: "2026-10-01T00:00:00Z",
        },
      ],
      plan_purchases: [
        sale({
          id: "s1",
          payment_status: "paid",
          coach_payout_cents: 2322,
          paid_at: "2026-11-10T10:00:00Z",
          created_at: "2026-11-10T10:00:00Z",
        }),
        sale({
          id: "s2",
          payment_status: "awaiting_coach_setup",
          created_at: "2026-11-09T10:00:00Z",
        }),
      ],
      plan_views: [
        { plan_id: "p1", viewed_on: "2026-11-10" },
        { plan_id: "p1", viewed_on: "2026-11-02" },
      ],
      athletes: [{ id: "a1", first_name: "Jamie", last_name: "Gilmore" }],
    });

    const d = await getCoachDashboard({ userId: "u-coach", admin, stripe: null }, TODAY);
    expect(d.connected).toBe(false);
    expect(d.totals).toMatchObject({
      salesCount: 2,
      earnedCents: 2322,
      pendingCents: 2499,
      onTheWayCents: 2499,
      stripeBalanceCents: null,
      paidOutCents: 2322,
      views: 4,
      conversion: 0.5,
      ratingAverage: 5,
      ratingCount: 1,
    });
    expect(d.plans).toEqual([
      {
        id: "p1",
        title: "Edge Control",
        priceCents: 2499,
        status: "active",
        soldCount: 2,
        views: 4,
      },
    ]);
    // This week (Mon 9 – Sun 15 Nov): 1 view, 2 sales; last week: 1 view.
    expect(d.weekly[0]).toEqual({
      weekStart: "2026-11-09",
      weekEnd: "2026-11-15",
      views: 1,
      sales: 2,
    });
    expect(d.weekly[1]).toMatchObject({ weekStart: "2026-11-02", views: 1, sales: 0 });
    expect(d.monthlyEarnings.at(-1)).toEqual({ month: "2026-11", cents: 2322 });
    expect(d.sales.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });
});
