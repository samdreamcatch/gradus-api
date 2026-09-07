import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  getAthleteGoalsDashboard,
  longTermGoalInput,
  motivationInput,
  updateAthleteLongTermGoal,
  updateAthleteMotivation,
} from "./athlete-goals.server";

type Filter = [column: string, value: unknown];
type Update = { table: string; payload: unknown; filters: Filter[] };

/**
 * A chainable fake: `rows[table]` answers `maybeSingle`/`single`;
 * `lists[table]` answers awaited selects, honoring `gte`, `order`, and
 * `limit` (not `eq`/`in`, so one list can serve several lookups). Every
 * `update(payload)` is recorded with the `eq` filters chained after it.
 */
function fakeClient(
  rows: Record<string, unknown | null>,
  lists: Record<string, unknown[]> = {},
  updates: Update[] = [],
) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    const filters: Filter[] = [];
    let list = (lists[table] ?? []) as Record<string, string | number>[];
    for (const m of ["select", "neq", "in", "lte", "lt", "delete", "insert", "upsert"]) {
      self[m] = () => self;
    }
    self.eq = (column: string, value: unknown) => {
      filters.push([column, value]);
      return self;
    };
    self.gte = (column: string, value: string | number) => {
      list = list.filter((row) => row[column] >= value);
      return self;
    };
    self.order = (column: string, o?: { ascending?: boolean }) => {
      const dir = o?.ascending === false ? -1 : 1;
      list = [...list].sort((a, b) =>
        a[column] < b[column] ? -dir : a[column] > b[column] ? dir : 0,
      );
      return self;
    };
    self.limit = (n: number) => {
      list = list.slice(0, n);
      return self;
    };
    self.update = (payload: unknown) => {
      updates.push({ table, payload, filters });
      return self;
    };
    self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    self.single = async () => ({ data: rows[table] ?? null, error: null });
    // Awaiting the chain itself (list reads and writes) resolves to the list.
    self.then = (resolve: (v: unknown) => void) => resolve({ data: list, error: null });
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

describe("goal inputs", () => {
  it("trims and caps the long-term goal at 280 characters", () => {
    expect(longTermGoalInput.parse({ sport: "tennis", longTermGoal: "  Varsity  " })).toEqual({
      sport: "tennis",
      longTermGoal: "Varsity",
    });
    expect(
      longTermGoalInput.safeParse({ sport: "tennis", longTermGoal: "x".repeat(280) }).success,
    ).toBe(true);
    expect(
      longTermGoalInput.safeParse({ sport: "tennis", longTermGoal: "x".repeat(281) }).success,
    ).toBe(false);
    expect(longTermGoalInput.safeParse({ sport: "", longTermGoal: "Varsity" }).success).toBe(false);
  });

  it("trims and caps the motivation at 500 characters", () => {
    expect(motivationInput.parse({ motivation: " Nationals " })).toEqual({
      motivation: "Nationals",
    });
    expect(motivationInput.safeParse({ motivation: "x".repeat(500) }).success).toBe(true);
    expect(motivationInput.safeParse({ motivation: "x".repeat(501) }).success).toBe(false);
  });
});

describe("updateAthleteLongTermGoal", () => {
  it("is 'Athlete not found' (404) for a user without an athlete row", async () => {
    const err = await caught(() =>
      updateAthleteLongTermGoal(
        { userId: "u", supabase: fakeClient({}) },
        { sport: "tennis", longTermGoal: "Varsity" },
      ),
    );
    expect(err?.status).toBe(404);
    expect(err?.code).toBe("not_found");
    expect(err?.message).toBe("Athlete not found");
  });

  it("writes the goal scoped to the caller's athlete and the sport", async () => {
    const updates: Update[] = [];
    const supabase = fakeClient({ athletes: { id: "a1" } }, {}, updates);
    expect(
      await updateAthleteLongTermGoal(
        { userId: "u", supabase },
        { sport: "tennis", longTermGoal: "Varsity" },
      ),
    ).toEqual({ ok: true });
    expect(updates).toEqual([
      {
        table: "athlete_goals",
        payload: { long_term_goal: "Varsity" },
        filters: [
          ["athlete_id", "a1"],
          ["sport", "tennis"],
        ],
      },
    ]);
  });
});

describe("updateAthleteMotivation", () => {
  it("writes the motivation scoped to the caller's user_id", async () => {
    const updates: Update[] = [];
    const supabase = fakeClient({}, {}, updates);
    expect(await updateAthleteMotivation({ userId: "u", supabase }, { motivation: "x" })).toEqual({
      ok: true,
    });
    expect(updates).toEqual([
      { table: "athletes", payload: { motivation: "x" }, filters: [["user_id", "u"]] },
    ]);
  });

  it("with apiContract, a caller without an athlete row is 404 not_found and nothing is written", async () => {
    const updates: Update[] = [];
    const err = await caught(() =>
      updateAthleteMotivation(
        { userId: "u", supabase: fakeClient({}, {}, updates) },
        { motivation: "x" },
        { apiContract: true },
      ),
    );
    expect(err?.status).toBe(404);
    expect(err?.code).toBe("not_found");
    expect(err?.message).toBe("Athlete not found");
    expect(updates).toEqual([]);
  });

  it("with apiContract, the caller's own row is written as before", async () => {
    const updates: Update[] = [];
    const supabase = fakeClient({ athletes: { id: "a1" } }, {}, updates);
    expect(
      await updateAthleteMotivation(
        { userId: "u", supabase },
        { motivation: "x" },
        { apiContract: true },
      ),
    ).toEqual({ ok: true });
    expect(updates).toHaveLength(1);
  });
});

describe("getAthleteGoalsDashboard", () => {
  it("is null for a user without an athlete row", async () => {
    const client = fakeClient({});
    expect(
      await getAthleteGoalsDashboard({ userId: "u", supabase: client, admin: client }),
    ).toBeNull();
  });

  it("builds the sports with the primary coach's override and an empty motivation", async () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    // Outside the trailing 28 days: excluded from the average, but it is the first session.
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const client = fakeClient(
      { athletes: { id: "a1", first_name: "Rory", last_name: "Gilmore", motivation: null } },
      {
        athlete_goals: [
          {
            sport: "tennis",
            current_level_key: "ntrp_3_0",
            season_goal_key: "ntrp_3_5",
            long_term_goal: "Varsity",
          },
        ],
        athlete_primary_coaches: [{ sport: "tennis", coach_id: "c1" }],
        coach_levels: [
          { coach_id: "c1", sport: "tennis", level_key: "ntrp_3_0", practice_hours_per_week: "2" },
        ],
        coach_athlete_practice_targets: [
          { sport: "tennis", hours_per_week: "6", coach_id: "c2" },
          { sport: "tennis", hours_per_week: "5", coach_id: "c1" },
        ],
        plan_sessions: [
          { duration_seconds: 7200, logged_at: recent },
          { duration_seconds: 36000, logged_at: old },
        ],
      },
    );
    const dashboard = await getAthleteGoalsDashboard({
      userId: "u",
      supabase: client,
      admin: client,
    });
    expect(dashboard).toEqual({
      athleteId: "a1",
      athleteName: "Rory Gilmore",
      motivation: "",
      sports: [
        {
          sport: "tennis",
          currentLevelKey: "ntrp_3_0",
          seasonGoalKey: "ntrp_3_5",
          longTermGoal: "Varsity",
          primaryCoachId: "c1",
          hoursAtCurrent: 5,
          hoursAtGoal: 5,
          // 7200 s / 3600 / 4 weeks = 0.5; the 40-day-old session is outside the window
          loggedHoursPerWeek: 0.5,
          sessionsCount: 1,
          firstSessionAt: old,
        },
      ],
    });
  });
});
