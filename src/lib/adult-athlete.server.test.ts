import { describe, expect, it } from "bun:test";
import { getAdultAthleteGoals } from "./adult-athlete.server";
import { adultGoalsListSchema } from "./api/athlete-schema";

/** Chainable fake: `rows[table]` answers `maybeSingle`; `lists[table]` answers awaited selects. */
function fakeClient(rows: Record<string, unknown | null>, lists: Record<string, unknown[]> = {}) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order"]) self[m] = () => self;
    self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: lists[table] ?? [], error: null });
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

describe("getAdultAthleteGoals (decision #60)", () => {
  it("is empty, never an error, before the athlete row exists", async () => {
    const out = await getAdultAthleteGoals({
      userId: "u",
      supabase: fakeClient({}),
      admin: fakeClient({}),
    });
    expect(out).toEqual({ goals: [] });
  });

  it("returns the goals on file with the coach's suggestion flag and name", async () => {
    const out = await getAdultAthleteGoals({
      userId: "u",
      supabase: fakeClient({ athletes: { id: "a1" } }),
      admin: fakeClient(
        {},
        {
          athlete_goals: [
            {
              athlete_id: "a1",
              sport: "tennis",
              coach_id: "coach-1",
              current_level_key: "ntrp_3_0",
              season_goal_key: "ntrp_3_5",
              long_term_goal: "",
              created_at: "2026-10-27T10:00:00Z",
            },
          ],
          athlete_goals_history: [
            {
              athlete_id: "a1",
              sport: "tennis",
              changed_by_role: "coach",
              created_at: "2026-10-27T10:00:00Z",
            },
          ],
          coach_profiles: [{ id: "coach-1", first_name: "Renata", last_name: "Pruitt" }],
        },
      ),
    });
    expect(out).toEqual({
      goals: [
        {
          sport: "tennis",
          currentLevelKey: "ntrp_3_0",
          seasonGoalKey: "ntrp_3_5",
          longTermGoal: "",
          suggestedByCoach: true,
          suggestedByCoachName: "Renata Pruitt",
        },
      ],
    });
    expect(adultGoalsListSchema.safeParse(out).success).toBe(true);
  });
});
