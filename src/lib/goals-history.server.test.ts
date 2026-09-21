import { describe, expect, it } from "bun:test";
import {
  authorshipFromRows,
  goalsDiffer,
  recordGoalsChange,
  type GoalsHistoryRow,
} from "./goals-history.server";

const row = (
  role: "parent" | "athlete",
  at: string,
  values: Partial<GoalsHistoryRow> = {},
): GoalsHistoryRow => ({
  sport: "figure_skating",
  changed_by_role: role,
  current_level_key: "juvenile",
  season_goal_key: "intermediate",
  long_term_goal: "Pass the test.",
  created_at: at,
  ...values,
});

describe("goalsDiffer", () => {
  it("compares levels exactly and the long-term goal trimmed", () => {
    const a = { currentLevelKey: "l1", seasonGoalKey: "g1", longTermGoal: "Go " };
    expect(goalsDiffer(a, { ...a, longTermGoal: "  Go" })).toBe(false);
    expect(goalsDiffer(a, { ...a, seasonGoalKey: "g2" })).toBe(true);
    expect(goalsDiffer(a, { ...a, longTermGoal: "Go far" })).toBe(true);
  });
});

describe("authorshipFromRows", () => {
  it("credits the latest row and flags the other author's version when it differs", () => {
    const out = authorshipFromRows([
      row("parent", "2026-09-06T14:30:00Z", { season_goal_key: "juvenile" }),
      row("athlete", "2026-09-13T16:10:00Z"),
    ]);
    const fs = out.get("figure_skating")!;
    expect(fs.lastSetBy).toEqual({ role: "athlete", at: "2026-09-13T16:10:00Z" });
    expect(fs.differsFrom).toEqual({
      role: "parent",
      at: "2026-09-06T14:30:00Z",
      currentLevelKey: "juvenile",
      seasonGoalKey: "juvenile",
      longTermGoal: "Pass the test.",
    });
  });

  it("does not flag agreement, or a sport only one person ever set", () => {
    const agree = authorshipFromRows([
      row("parent", "2026-09-06T14:30:00Z"),
      row("athlete", "2026-09-13T16:10:00Z"),
    ]).get("figure_skating")!;
    expect(agree.lastSetBy?.role).toBe("athlete");
    expect(agree.differsFrom).toBeNull();

    const solo = authorshipFromRows([
      row("parent", "2026-09-01T00:00:00Z", { season_goal_key: "juvenile" }),
      row("parent", "2026-09-06T14:30:00Z"),
    ]).get("figure_skating")!;
    expect(solo.lastSetBy).toEqual({ role: "parent", at: "2026-09-06T14:30:00Z" });
    expect(solo.differsFrom).toBeNull();
  });

  it("uses the other author's most recent row, not their first, and keeps sports apart", () => {
    const out = authorshipFromRows([
      row("athlete", "2026-09-01T00:00:00Z", { season_goal_key: "novice" }),
      row("athlete", "2026-09-05T00:00:00Z", { season_goal_key: "juvenile" }),
      row("parent", "2026-09-10T00:00:00Z"),
      row("parent", "2026-09-11T00:00:00Z", {
        sport: "hockey",
        current_level_key: "l1",
        season_goal_key: "g1",
      }),
    ]);
    expect(out.get("figure_skating")?.differsFrom?.seasonGoalKey).toBe("juvenile");
    expect(out.get("hockey")?.differsFrom).toBeNull();
    expect(out.get("hockey")?.lastSetBy?.role).toBe("parent");
  });
});

describe("authorshipFromRows with a floor", () => {
  it("ignores rows from before the goal now on file was created", () => {
    const rows = [
      row("parent", "2026-08-01T00:00:00Z", { season_goal_key: "juvenile" }),
      row("athlete", "2026-09-13T16:10:00Z"),
    ];
    // The parent's row predates a re-created goal (coach unlinked, then re-set).
    const fs = authorshipFromRows(rows, { figure_skating: "2026-09-01T00:00:00Z" }).get(
      "figure_skating",
    )!;
    expect(fs.lastSetBy?.role).toBe("athlete");
    expect(fs.differsFrom).toBeNull();
    // No floor for the sport: every row counts.
    expect(
      authorshipFromRows(rows, { hockey: "2026-09-01T00:00:00Z" }).get("figure_skating")
        ?.differsFrom?.role,
    ).toBe("parent");
  });
});

describe("recordGoalsChange", () => {
  const fakeAdmin = (calls: unknown[]) =>
    ({
      from: (table: string) => ({
        insert: async (payload: unknown) => {
          calls.push({ table, payload });
          return { error: null };
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
  const next = { currentLevelKey: "l1", seasonGoalKey: "g2", longTermGoal: "Go" };

  it("inserts a row carrying what it replaced", async () => {
    const calls: unknown[] = [];
    await recordGoalsChange(fakeAdmin(calls), {
      athleteId: "a1",
      sport: "hockey",
      role: "athlete",
      userId: "u1",
      next,
      previous: { currentLevelKey: "l1", seasonGoalKey: "g1", longTermGoal: "Go" },
    });
    expect(calls).toEqual([
      {
        table: "athlete_goals_history",
        payload: {
          athlete_id: "a1",
          sport: "hockey",
          changed_by_role: "athlete",
          changed_by_user_id: "u1",
          current_level_key: "l1",
          season_goal_key: "g2",
          long_term_goal: "Go",
          previous_current_level_key: "l1",
          previous_season_goal_key: "g1",
          previous_long_term_goal: "Go",
        },
      },
    ]);
  });

  it("writes nothing when the save changed nothing", async () => {
    const calls: unknown[] = [];
    await recordGoalsChange(fakeAdmin(calls), {
      athleteId: "a1",
      sport: "hockey",
      role: "parent",
      userId: null,
      next,
      previous: { ...next, longTermGoal: " Go " },
    });
    expect(calls).toEqual([]);
  });

  it("records a first save with null previous values", async () => {
    const calls: unknown[] = [];
    await recordGoalsChange(fakeAdmin(calls), {
      athleteId: "a1",
      sport: "hockey",
      role: "parent",
      userId: "u1",
      next,
      previous: null,
    });
    expect(
      (calls[0] as { payload: { previous_season_goal_key: unknown } }).payload
        .previous_season_goal_key,
    ).toBeNull();
  });
});
