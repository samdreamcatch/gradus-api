import { describe, expect, it } from "bun:test";
import {
  decodeRatingsCursor,
  deleteMyPlanRating,
  encodeRatingsCursor,
  getPlanRatingSummary,
  listPlanRatings,
  ratePlan,
  ratePlanInput,
  respondToPlanRating,
  respondToRatingInput,
  reviewerName,
  type PlanRatingsContext,
} from "./plan-ratings.server";

const PLAN = "6a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const RATING = "7b2f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

type Row = Record<string, unknown>;
type Call = { table: string; op: string; payload?: unknown; filters: unknown[][] };

/**
 * A query builder over in-memory tables: `eq`/`in` filter rows, the rest is
 * recorded. `upsert`/`update` answer with `writeResult`.
 */
function fakeClient(
  tables: Record<string, Row[]>,
  rpc: Record<string, unknown> = {},
  writeResult: Row | null = null,
) {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => {
      let rows = [...(tables[table] ?? [])];
      const call: Call = { table, op: "select", filters: [] };
      calls.push(call);
      const result = () => (call.op === "select" ? rows : writeResult ? [writeResult] : []);
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          call.filters.push(["eq", col, val]);
          rows = rows.filter((r) => r[col] === val);
          return chain;
        },
        in: (col: string, vals: unknown[]) => {
          rows = rows.filter((r) => vals.includes(r[col]));
          return chain;
        },
        or: (filter: string) => {
          call.filters.push(["or", filter]);
          return chain;
        },
        order: () => chain,
        limit: (n: number) => Promise.resolve({ data: rows.slice(0, n), error: null }),
        maybeSingle: () => Promise.resolve({ data: result()[0] ?? null, error: null }),
        single: () => Promise.resolve({ data: result()[0] ?? null, error: null }),
        upsert: (payload: unknown) => {
          call.op = "upsert";
          call.payload = payload;
          return chain;
        },
        update: (payload: unknown) => {
          call.op = "update";
          call.payload = payload;
          return chain;
        },
        delete: () => {
          call.op = "delete";
          return chain;
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: result(), error: null }),
      };
      return chain;
    },
    rpc: (fn: string) => Promise.resolve({ data: rpc[fn] ?? false, error: null }),
  } as unknown as PlanRatingsContext["supabase"];
  return { client, calls };
}

const ratingRow = (over: Row = {}): Row => ({
  id: RATING,
  plan_id: PLAN,
  user_id: "u-parent",
  rating: 5,
  review: "Clear and fun.",
  coach_response: null,
  coach_responded_at: null,
  created_at: "2026-11-05T10:00:00.000Z",
  updated_at: "2026-11-05T10:00:00.000Z",
  ...over,
});

const people = {
  athletes: [{ id: "a1", user_id: "u-athlete", first_name: "Greta", last_name: "Svensson" }],
  parent_profiles: [{ user_id: "u-parent", first_name: "Maria", last_name: "svensson" }],
};

describe("inputs", () => {
  it("takes 1 to 5 whole stars and an optional review", () => {
    expect(ratePlanInput.safeParse({ rating: 4 }).success).toBe(true);
    expect(ratePlanInput.safeParse({ rating: 5, review: "Great." }).success).toBe(true);
    for (const rating of [0, 6, 3.5]) {
      expect(ratePlanInput.safeParse({ rating }).success).toBe(false);
    }
    expect(ratePlanInput.safeParse({ rating: 3, review: "x".repeat(2001) }).success).toBe(false);
  });

  it("takes a reply, or null to remove it, but not a blank one", () => {
    expect(respondToRatingInput.safeParse({ response: "Thank you!" }).success).toBe(true);
    expect(respondToRatingInput.safeParse({ response: null }).success).toBe(true);
    expect(respondToRatingInput.safeParse({ response: "  " }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("shows a first name and last initial", () => {
    expect(reviewerName("Greta", "svensson")).toBe("Greta S.");
    expect(reviewerName("Greta", "")).toBe("Greta");
  });

  it("round-trips a cursor and refuses anything else", () => {
    const cursor = encodeRatingsCursor("2026-11-05T10:00:00.000Z", RATING);
    expect(decodeRatingsCursor(cursor)).toEqual({
      createdAt: "2026-11-05T10:00:00.000Z",
      id: RATING,
    });
    expect(() => decodeRatingsCursor("nope")).toThrow();
  });
});

describe("ratePlan", () => {
  it("refuses anyone the database won't let rate the plan", async () => {
    const { client, calls } = fakeClient({}, { can_rate_plan: false });
    await expect(
      ratePlan({ userId: "u-coach", supabase: client, admin: client }, PLAN, { rating: 5 }),
    ).rejects.toThrow("Only the plan's athlete and their parents can rate it.");
    expect(calls.some((c) => c.op === "upsert")).toBe(false);
  });

  it("upserts the caller's one rating and names them", async () => {
    const user = fakeClient({}, { can_rate_plan: true }, ratingRow({ review: null }));
    const admin = fakeClient({ plans: [{ id: PLAN, athlete_id: "a1" }], ...people });
    const now = new Date("2026-11-05T10:00:00.000Z");
    const dto = await ratePlan(
      { userId: "u-parent", supabase: user.client, admin: admin.client },
      PLAN,
      { rating: 5, review: "" },
      now,
    );
    expect(user.calls.find((c) => c.op === "upsert")?.payload).toEqual({
      plan_id: PLAN,
      user_id: "u-parent",
      rating: 5,
      review: null,
      updated_at: now.toISOString(),
    });
    expect(dto.reviewer).toEqual({ name: "Maria S.", role: "parent" });
  });
});

describe("respondToPlanRating", () => {
  it("lets only the plan's coach reply", async () => {
    const { client } = fakeClient({}, { is_plan_coach: false });
    await expect(
      respondToPlanRating({ userId: "u", supabase: client, admin: client }, PLAN, RATING, {
        response: "Thanks",
      }),
    ).rejects.toThrow("Only the plan's coach can reply to its ratings.");
  });

  it("stamps the reply and clears the stamp with it", async () => {
    const user = fakeClient({}, { is_plan_coach: true }, ratingRow());
    const admin = fakeClient({ plans: [{ id: PLAN, athlete_id: "a1" }], ...people });
    const ctx = { userId: "u-coach", supabase: user.client, admin: admin.client };
    const now = new Date("2026-11-06T09:00:00.000Z");
    await respondToPlanRating(ctx, PLAN, RATING, { response: "Thank you!" }, now);
    await respondToPlanRating(ctx, PLAN, RATING, { response: null }, now);
    expect(user.calls.filter((c) => c.op === "update").map((c) => c.payload)).toEqual([
      { coach_response: "Thank you!", coach_responded_at: now.toISOString() },
      { coach_response: null, coach_responded_at: null },
    ]);
  });
});

describe("deleteMyPlanRating", () => {
  it("deletes only the caller's own rating", async () => {
    const { client, calls } = fakeClient({});
    await deleteMyPlanRating({ userId: "u-parent", supabase: client, admin: client }, PLAN);
    const del = calls.find((c) => c.op === "delete")!;
    expect(del.filters).toEqual([
      ["eq", "plan_id", PLAN],
      ["eq", "user_id", "u-parent"],
    ]);
  });
});

describe("listPlanRatings", () => {
  const listedPlan = {
    id: PLAN,
    athlete_id: "a1",
    status: "active",
    rating_avg: "4.50",
    rating_count: 2,
    coach: { subscription_tier: "coach_pro", organization_id: null },
  };

  it("hides a plan the caller can't see that isn't a marketplace listing", async () => {
    const user = fakeClient({ plans: [] });
    const admin = fakeClient({
      plans: [{ ...listedPlan, coach: { subscription_tier: "coach", organization_id: null } }],
    });
    await expect(
      listPlanRatings({ userId: "u", supabase: user.client, admin: admin.client }, PLAN, {
        limit: 20,
      }),
    ).rejects.toThrow("Plan not found");
  });

  it("gives a listing's average rating, and null with no ratings yet", async () => {
    const user = fakeClient({ plans: [] });
    const ctx = (plan: Row) => ({
      userId: "u",
      supabase: user.client,
      admin: fakeClient({ plans: [plan] }).client,
    });
    expect(await getPlanRatingSummary(ctx(listedPlan), PLAN)).toEqual({ average: 4.5, count: 2 });
    expect(
      await getPlanRatingSummary(ctx({ ...listedPlan, rating_avg: null, rating_count: 0 }), PLAN),
    ).toEqual({ average: null, count: 0 });
  });

  it("returns totals, the caller's rating, and named reviews for a listing", async () => {
    const user = fakeClient({ plans: [] }, { can_rate_plan: true });
    const admin = fakeClient({
      plans: [listedPlan],
      plan_ratings: [
        ratingRow(),
        ratingRow({ id: "r2", user_id: "u-athlete", rating: 4, review: null }),
      ],
      ...people,
    });
    const page = await listPlanRatings(
      { userId: "u-athlete", supabase: user.client, admin: admin.client },
      PLAN,
      { limit: 1 },
    );
    expect(page.summary).toEqual({ average: 4.5, count: 2 });
    expect(page.canRate).toBe(true);
    expect(page.myRating?.reviewer).toEqual({ name: "Greta S.", role: "athlete" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].reviewer).toEqual({ name: "Maria S.", role: "parent" });
    expect(page.nextCursor).not.toBeNull();
  });
});
