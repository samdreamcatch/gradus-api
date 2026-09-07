import { describe, expect, it } from "bun:test";
import { getParentGoalsDashboard } from "./parent-goals.server";

/**
 * A chainable fake: `rows[table]` answers `maybeSingle`/`single`;
 * `lists[table]` answers awaited selects, honoring `gte`, `order`, and
 * `limit` (not `eq`/`in`, so one list can serve several lookups).
 */
function fakeClient(rows: Record<string, unknown | null>, lists: Record<string, unknown[]> = {}) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    let list = (lists[table] ?? []) as Record<string, string | number>[];
    for (const m of [
      "select",
      "eq",
      "neq",
      "in",
      "lte",
      "lt",
      "update",
      "delete",
      "insert",
      "upsert",
    ]) {
      self[m] = () => self;
    }
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
    self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    self.single = async () => ({ data: rows[table] ?? null, error: null });
    // Awaiting the chain itself (list reads and writes) resolves to the list.
    self.then = (resolve: (v: unknown) => void) => resolve({ data: list, error: null });
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

const parent = { parent_profiles: { id: "parent-1" } };
// The `athletes` list answers both the guardian lookup (`select id`) and the
// name read, so every row carries the name columns.
const athletes = [{ id: "a1", first_name: "Rory", last_name: "Gilmore" }];
// Tennis NTRP 3.0 → 3.5: Gradus suggests 3 and 4 hr/wk.
const goals = [
  {
    athlete_id: "a1",
    sport: "tennis",
    current_level_key: "ntrp_3_0",
    season_goal_key: "ntrp_3_5",
    long_term_goal: "Varsity",
  },
];
const primary = [{ athlete_id: "a1", sport: "tennis", coach_id: "c1" }];
const levels = [
  { coach_id: "c1", sport: "tennis", level_key: "ntrp_3_0", practice_hours_per_week: "2" },
  { coach_id: "c1", sport: "tennis", level_key: "ntrp_3_5", practice_hours_per_week: "2.5" },
];

async function dashboard(lists: Record<string, unknown[]>) {
  const client = fakeClient(parent, lists);
  return getParentGoalsDashboard({ userId: "u", supabase: client, admin: client });
}

describe("getParentGoalsDashboard", () => {
  it("is empty for a user without a parent profile", async () => {
    const client = fakeClient({}, { athletes });
    expect(await getParentGoalsDashboard({ userId: "u", supabase: client, admin: client })).toEqual(
      [],
    );
  });

  it("a per-athlete override from the primary coach beats the coach's level hours", async () => {
    const [a] = await dashboard({
      athletes,
      athlete_goals: goals,
      athlete_primary_coaches: primary,
      coach_levels: levels,
      coach_athlete_practice_targets: [
        { athlete_id: "a1", sport: "tennis", hours_per_week: "6", coach_id: "c1" },
      ],
    });
    expect(a.athleteName).toBe("Rory Gilmore");
    expect(a.sports[0].primaryCoachId).toBe("c1");
    expect(a.sports[0].hoursAtCurrent).toBe(6);
    expect(a.sports[0].hoursAtGoal).toBe(6);
  });

  it("the primary coach's level hours beat the Gradus default", async () => {
    const [a] = await dashboard({
      athletes,
      athlete_goals: goals,
      athlete_primary_coaches: primary,
      coach_levels: levels,
    });
    expect(a.sports[0].hoursAtCurrent).toBe(2);
    expect(a.sports[0].hoursAtGoal).toBe(2.5);
  });

  it("an override from a coach who is not the primary coach is ignored", async () => {
    const [a] = await dashboard({
      athletes,
      athlete_goals: goals,
      athlete_primary_coaches: primary,
      coach_levels: levels,
      coach_athlete_practice_targets: [
        { athlete_id: "a1", sport: "tennis", hours_per_week: "6", coach_id: "c2" },
      ],
    });
    expect(a.sports[0].hoursAtCurrent).toBe(2);
    expect(a.sports[0].hoursAtGoal).toBe(2.5);
  });

  it("falls back to the Gradus default when the athlete has no coach", async () => {
    const [a] = await dashboard({ athletes, athlete_goals: goals });
    expect(a.sports[0].primaryCoachId).toBeNull();
    expect(a.sports[0].hoursAtCurrent).toBe(3);
    expect(a.sports[0].hoursAtGoal).toBe(4);
  });

  it("averages the trailing 28 days into hr/wk to one decimal and keeps the first session", async () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const earlier = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    // Outside the window: excluded from the average, but it is the first
    // session, and it is listed last so the ordering (not the array
    // position) must find it.
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const [a] = await dashboard({
      athletes,
      athlete_goals: goals,
      plan_sessions: [
        { athlete_id: "a1", duration_seconds: 5400, logged_at: earlier },
        { athlete_id: "a1", duration_seconds: 3600, logged_at: recent },
        { athlete_id: "a1", duration_seconds: 36000, logged_at: old },
      ],
    });
    // 9000 s / 3600 / 4 weeks = 0.625 → 0.6
    expect(a.sports[0].loggedHoursPerWeek).toBe(0.6);
    expect(a.sports[0].sessionsCount).toBe(2);
    expect(a.sports[0].firstSessionAt).toBe(old);
  });

  it("an athlete with no sessions reports zero and no first session", async () => {
    const [a] = await dashboard({ athletes, athlete_goals: goals });
    expect(a.sports[0].loggedHoursPerWeek).toBe(0);
    expect(a.sports[0].sessionsCount).toBe(0);
    expect(a.sports[0].firstSessionAt).toBeNull();
  });
});
