import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  refineStartingLevels,
  resolveStartingLevels,
  startingLevelKeySchema,
  startingLevelsOf,
  STARTING_LEVELS_BOTH_OR_NEITHER,
  STARTING_LEVELS_NEED_SPORT,
  STARTING_LEVELS_UNKNOWN,
} from "./starting-levels";

const issues = () => {
  const out: { message: string; path: string[] }[] = [];
  return { out, issue: (message: string, path: string[]) => out.push({ message, path }) };
};

describe("resolveStartingLevels (decision #60)", () => {
  it("is null, with no issue, when the coach skipped the block", () => {
    const { out, issue } = issues();
    expect(resolveStartingLevels({ sport: "figure_skating" }, issue)).toBeNull();
    expect(
      resolveStartingLevels(
        { sport: "figure_skating", currentLevelKey: "", seasonGoalKey: null },
        issue,
      ),
    ).toBeNull();
    expect(out).toEqual([]);
  });

  it("needs both keys or neither, pointing at the missing one", () => {
    const { out, issue } = issues();
    resolveStartingLevels({ sport: "figure_skating", currentLevelKey: "juvenile" }, issue);
    resolveStartingLevels({ sport: "figure_skating", seasonGoalKey: "juvenile" }, issue);
    expect(out).toEqual([
      { message: STARTING_LEVELS_BOTH_OR_NEITHER, path: ["seasonGoalKey"] },
      { message: STARTING_LEVELS_BOTH_OR_NEITHER, path: ["currentLevelKey"] },
    ]);
  });

  it("needs a sport to validate against", () => {
    const { out, issue } = issues();
    expect(
      resolveStartingLevels(
        { sport: "", currentLevelKey: "juvenile", seasonGoalKey: "intermediate" },
        issue,
      ),
    ).toBeNull();
    expect(out).toEqual([{ message: STARTING_LEVELS_NEED_SPORT, path: ["sport"] }]);
  });

  it("checks each key against the sport's own catalog", () => {
    const { out, issue } = issues();
    expect(
      resolveStartingLevels(
        { sport: "figure_skating", currentLevelKey: "nope", seasonGoalKey: "juvenile" },
        issue,
      ),
    ).toBeNull();
    expect(out).toEqual([{ message: STARTING_LEVELS_UNKNOWN, path: ["currentLevelKey"] }]);
    // A real level of another sport is still unknown here.
    const second = issues();
    resolveStartingLevels(
      { sport: "figure_skating", currentLevelKey: "juvenile", seasonGoalKey: "varsity" },
      second.issue,
    );
    expect(second.out.map((i) => i.path)).toEqual([["seasonGoalKey"]]);
  });

  it("returns the pair when both are levels of the sport", () => {
    const { out, issue } = issues();
    expect(
      resolveStartingLevels(
        { sport: "figure_skating", currentLevelKey: "pre_juvenile", seasonGoalKey: "juvenile" },
        issue,
      ),
    ).toEqual({ currentLevelKey: "pre_juvenile", seasonGoalKey: "juvenile" });
    expect(out).toEqual([]);
  });
});

describe("refineStartingLevels as a zod refinement", () => {
  const schema = z
    .object({
      sport: z.string().default(""),
      currentLevelKey: startingLevelKeySchema,
      seasonGoalKey: startingLevelKeySchema,
    })
    .superRefine(refineStartingLevels);

  it("normalizes blank and null keys to undefined so the pair reads as skipped", () => {
    const parsed = schema.parse({
      sport: "figure_skating",
      currentLevelKey: "",
      seasonGoalKey: null,
    });
    expect(parsed.currentLevelKey).toBeUndefined();
    expect(parsed.seasonGoalKey).toBeUndefined();
    expect(startingLevelsOf(parsed)).toBeNull();
  });

  it("surfaces the validation messages on the right paths", () => {
    const r = schema.safeParse({ sport: "figure_skating", currentLevelKey: "juvenile" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues).toEqual([
        expect.objectContaining({
          message: STARTING_LEVELS_BOTH_OR_NEITHER,
          path: ["seasonGoalKey"],
        }),
      ]);
    }
  });

  it("accepts a valid pair and startingLevelsOf reads it back", () => {
    const parsed = schema.parse({
      sport: "figure_skating",
      currentLevelKey: " juvenile ",
      seasonGoalKey: "intermediate",
    });
    expect(startingLevelsOf(parsed)).toEqual({
      currentLevelKey: "juvenile",
      seasonGoalKey: "intermediate",
    });
  });
});
