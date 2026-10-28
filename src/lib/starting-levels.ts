/**
 * Starting levels at invite (Mariah, 2026-10-27, decision #60): a coach may
 * pre-populate an athlete's current level and season target when inviting
 * them — on the New athlete sheet and on each new-athlete card of the
 * schedule import review. Closed by default and trivially skippable, so the
 * fields are optional, but they travel together: both keys or neither.
 *
 * Pure validation shared by `addAthleteInput` (coach-roster.server.ts) and
 * `commitScheduleImportInput` (schedule-import.server.ts); the write itself
 * is `applyCoachStartingLevels` in goals-history.server.ts.
 */
import { z } from "zod";
import { getSportLevel } from "./coach-sports";

export const STARTING_LEVELS_BOTH_OR_NEITHER =
  "Pick both a current level and a season target, or leave both empty.";
export const STARTING_LEVELS_NEED_SPORT = "Pick a sport before setting starting levels.";
export const STARTING_LEVELS_UNKNOWN = "That level isn't one of this sport's levels.";

export type StartingLevels = { currentLevelKey: string; seasonGoalKey: string };

/** The optional pair on an invite input; `undefined`, `null` and `""` all mean "not set". */
export const startingLevelKeySchema = z
  .string()
  .trim()
  .max(64)
  .nullish()
  .transform((v) => (v ? v : undefined));

/**
 * Both-or-neither, and both keys in the sport's catalog. Returns the pair, or
 * null when the coach skipped the block. `sport` empty with levels set is an
 * error: the catalog is per sport, so there is nothing to validate against.
 */
export function resolveStartingLevels(
  input: { sport?: string | null; currentLevelKey?: string | null; seasonGoalKey?: string | null },
  issue: (message: string, path: string[]) => void,
): StartingLevels | null {
  const cur = input.currentLevelKey || undefined;
  const target = input.seasonGoalKey || undefined;
  if (!cur && !target) return null;
  if (!cur || !target) {
    issue(STARTING_LEVELS_BOTH_OR_NEITHER, [cur ? "seasonGoalKey" : "currentLevelKey"]);
    return null;
  }
  const sport = input.sport || "";
  if (!sport) {
    issue(STARTING_LEVELS_NEED_SPORT, ["sport"]);
    return null;
  }
  let ok = true;
  if (!getSportLevel(sport, cur)) {
    issue(STARTING_LEVELS_UNKNOWN, ["currentLevelKey"]);
    ok = false;
  }
  if (!getSportLevel(sport, target)) {
    issue(STARTING_LEVELS_UNKNOWN, ["seasonGoalKey"]);
    ok = false;
  }
  return ok ? { currentLevelKey: cur, seasonGoalKey: target } : null;
}

/** A zod `superRefine` over any object carrying `sport`, `currentLevelKey`, `seasonGoalKey`. */
export function refineStartingLevels<
  T extends {
    sport?: string | null;
    currentLevelKey?: string | null;
    seasonGoalKey?: string | null;
  },
>(v: T, ctx: z.RefinementCtx): void {
  resolveStartingLevels(v, (message, path) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path }),
  );
}

/** After parsing: the pair when both are present (validation already ran), else null. */
export function startingLevelsOf(v: {
  currentLevelKey?: string | null;
  seasonGoalKey?: string | null;
}): StartingLevels | null {
  return v.currentLevelKey && v.seasonGoalKey
    ? { currentLevelKey: v.currentLevelKey, seasonGoalKey: v.seasonGoalKey }
    : null;
}
