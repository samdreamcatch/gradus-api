import { describe, expect, it } from "bun:test";
import {
  deleteMyCoachRating,
  getCoachRatingSummary,
  listCoachRatings,
  rateCoach,
  rateCoachInput,
  respondToCoachRating,
  respondToCoachRatingInput,
  type CoachRatingsContext,
} from "./coach-ratings.server";

const COACH = "6a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
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
  } as unknown as CoachRatingsContext["supabase"];
  return { client, calls };
}

const ratingRow = (over: Row = {}): Row => ({
  id: RATING,
  coach_id: COACH,
  user_id: "u-parent",
  rating: 5,
  review: "Patient and clear.",
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

const listedCoach = {
  id: COACH,
  subscription_tier: "coach_pro",
  organization_id: null,
  rating_avg: "4.50",
  rating_count: 2,
};

describe("inputs", () => {
  it("takes 1 to 5 whole stars and an optional review", () => {
    expect(rateCoachInput.safeParse({ rating: 4 }).success).toBe(true);
    expect(rateCoachInput.safeParse({ rating: 5, review: "Great." }).success).toBe(true);
    for (const rating of [0, 6, 3.5]) {
      expect(rateCoachInput.safeParse({ rating }).success).toBe(false);
    }
    expect(rateCoachInput.safeParse({ rating: 3, review: "x".repeat(2001) }).success).toBe(false);
  });

  it("takes a reply, or null to remove it, but not a blank one", () => {
    expect(respondToCoachRatingInput.safeParse({ response: "Thank you!" }).success).toBe(true);
    expect(respondToCoachRatingInput.safeParse({ response: null }).success).toBe(true);
    expect(respondToCoachRatingInput.safeParse({ response: "  " }).success).toBe(false);
  });
});

describe("rateCoach", () => {
  it("refuses anyone who hasn't worked with the coach", async () => {
    const { client, calls } = fakeClient({}, { can_rate_coach: false });
    await expect(
      rateCoach({ userId: "u-stranger", supabase: client, admin: client }, COACH, { rating: 5 }),
    ).rejects.toThrow("Only athletes and parents who have worked with this coach can rate them.");
    expect(calls.some((c) => c.op === "upsert")).toBe(false);
  });

  it("upserts the caller's one rating and names them", async () => {
    const user = fakeClient({}, { can_rate_coach: true }, ratingRow({ review: null }));
    const admin = fakeClient(people);
    const now = new Date("2026-11-05T10:00:00.000Z");
    const dto = await rateCoach(
      { userId: "u-parent", supabase: user.client, admin: admin.client },
      COACH,
      { rating: 5, review: "" },
      now,
    );
    expect(user.calls.find((c) => c.op === "upsert")?.payload).toEqual({
      coach_id: COACH,
      user_id: "u-parent",
      rating: 5,
      review: null,
      updated_at: now.toISOString(),
    });
    expect(dto.reviewer).toEqual({ name: "Maria S.", role: "parent" });
  });
});

describe("respondToCoachRating", () => {
  it("lets only the coach reply", async () => {
    const { client } = fakeClient({}, { is_rated_coach: false });
    await expect(
      respondToCoachRating({ userId: "u", supabase: client, admin: client }, COACH, RATING, {
        response: "Thanks",
      }),
    ).rejects.toThrow("Only the coach can reply to ratings of them.");
  });

  it("stamps the reply and clears the stamp with it", async () => {
    const user = fakeClient({}, { is_rated_coach: true }, ratingRow());
    const admin = fakeClient(people);
    const ctx = { userId: "u-coach", supabase: user.client, admin: admin.client };
    const now = new Date("2026-11-06T09:00:00.000Z");
    await respondToCoachRating(ctx, COACH, RATING, { response: "Thank you!" }, now);
    await respondToCoachRating(ctx, COACH, RATING, { response: null }, now);
    expect(user.calls.filter((c) => c.op === "update").map((c) => c.payload)).toEqual([
      { coach_response: "Thank you!", coach_responded_at: now.toISOString() },
      { coach_response: null, coach_responded_at: null },
    ]);
  });
});

describe("deleteMyCoachRating", () => {
  it("deletes only the caller's own rating", async () => {
    const { client, calls } = fakeClient({});
    await deleteMyCoachRating({ userId: "u-parent", supabase: client, admin: client }, COACH);
    expect(calls.find((c) => c.op === "delete")!.filters).toEqual([
      ["eq", "coach_id", COACH],
      ["eq", "user_id", "u-parent"],
    ]);
  });
});

describe("listCoachRatings", () => {
  it("hides a coach who doesn't sell plans from someone who never worked with them", async () => {
    const user = fakeClient({});
    const admin = fakeClient({
      coach_profiles: [{ ...listedCoach, subscription_tier: "coach" }],
    });
    await expect(
      listCoachRatings({ userId: "u", supabase: user.client, admin: admin.client }, COACH, {
        limit: 20,
      }),
    ).rejects.toThrow("Coach not found");
  });

  it("still shows that coach's ratings to someone who worked with them", async () => {
    const user = fakeClient({}, { can_rate_coach: true });
    const admin = fakeClient({
      coach_profiles: [{ ...listedCoach, subscription_tier: "coach" }],
    });
    const page = await listCoachRatings(
      { userId: "u", supabase: user.client, admin: admin.client },
      COACH,
      { limit: 20 },
    );
    expect(page.canRate).toBe(true);
  });

  it("gives the average rating, and null with no ratings yet", async () => {
    const user = fakeClient({});
    const ctx = (coach: Row) => ({
      userId: "u",
      supabase: user.client,
      admin: fakeClient({ coach_profiles: [coach] }).client,
    });
    expect(await getCoachRatingSummary(ctx(listedCoach), COACH)).toEqual({
      average: 4.5,
      count: 2,
    });
    expect(
      await getCoachRatingSummary(
        ctx({ ...listedCoach, rating_avg: null, rating_count: 0 }),
        COACH,
      ),
    ).toEqual({ average: null, count: 0 });
  });

  it("returns totals, the caller's rating, and named reviews", async () => {
    const user = fakeClient({}, { can_rate_coach: true, is_rated_coach: false });
    const admin = fakeClient({
      coach_profiles: [listedCoach],
      coach_ratings: [
        ratingRow(),
        ratingRow({ id: "r2", user_id: "u-athlete", rating: 4, review: null }),
      ],
      ...people,
    });
    const page = await listCoachRatings(
      { userId: "u-athlete", supabase: user.client, admin: admin.client },
      COACH,
      { limit: 1 },
    );
    expect(page.summary).toEqual({ average: 4.5, count: 2 });
    expect(page.canRate).toBe(true);
    expect(page.canRespond).toBe(false);
    expect(page.myRating?.reviewer).toEqual({ name: "Greta S.", role: "athlete" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].reviewer).toEqual({ name: "Maria S.", role: "parent" });
    expect(page.nextCursor).not.toBeNull();
  });
});
