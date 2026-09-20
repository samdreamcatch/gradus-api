/**
 * Goals history (Mariah, 2026-09-20): who set an athlete's goals and what
 * they replaced, so a coach can see when the parent and the athlete want
 * different things.
 *
 * `athlete_goals` is one row per (athlete, sport), last writer wins, with no
 * author. Both write paths — the parent's `setParentAthleteGoals` and the
 * athlete's `saveAdultAthleteGoals` — call `recordGoalsChange` after their
 * upsert; the coach's athlete detail calls `goalsAuthorship` to decorate each
 * goal with who set it last and, when the other person's most recent goals
 * differ from what is saved now, that other version.
 *
 * Service role only: the table has RLS on with no policies (migration
 * 20260920210000), so every call here takes the admin client.
 */
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dbError } from "./db-error";

type Admin = typeof supabaseAdmin;

export type GoalsAuthorRole = "parent" | "athlete";

export interface GoalValues {
  currentLevelKey: string;
  seasonGoalKey: string;
  longTermGoal: string;
}

/** Who last saved a goal. */
export interface GoalsLastSetBy {
  role: GoalsAuthorRole;
  /** ISO timestamp. */
  at: string;
}

/** The other person's most recent goals, when they differ from what is saved now. */
export interface GoalsOtherVersion extends GoalValues {
  role: GoalsAuthorRole;
  /** ISO timestamp of when they set it. */
  at: string;
}

export interface GoalsAuthorship {
  lastSetBy: GoalsLastSetBy | null;
  differsFrom: GoalsOtherVersion | null;
}

const norm = (s: string) => s.trim();

/** Materially different: either level differs, or the long-term goal differs once trimmed. */
export function goalsDiffer(a: GoalValues, b: GoalValues): boolean {
  return (
    a.currentLevelKey !== b.currentLevelKey ||
    a.seasonGoalKey !== b.seasonGoalKey ||
    norm(a.longTermGoal) !== norm(b.longTermGoal)
  );
}

/**
 * Append one history row for a save, unless nothing changed. `previous` is
 * the row that was on file before the upsert (null for a first save).
 */
export async function recordGoalsChange(
  admin: Admin,
  args: {
    athleteId: string;
    sport: string;
    role: GoalsAuthorRole;
    userId: string | null;
    next: GoalValues;
    previous: GoalValues | null;
  },
): Promise<void> {
  if (args.previous && !goalsDiffer(args.previous, args.next)) return;
  const ins = await admin.from("athlete_goals_history").insert({
    athlete_id: args.athleteId,
    sport: args.sport,
    changed_by_role: args.role,
    changed_by_user_id: args.userId,
    current_level_key: args.next.currentLevelKey,
    season_goal_key: args.next.seasonGoalKey,
    long_term_goal: args.next.longTermGoal,
    previous_current_level_key: args.previous?.currentLevelKey ?? null,
    previous_season_goal_key: args.previous?.seasonGoalKey ?? null,
    previous_long_term_goal: args.previous?.longTermGoal ?? null,
  });
  if (ins.error) dbError(ins.error);
}

/** The goal on file for (athlete, sport), or null. Read before an upsert so the change can be recorded. */
export async function currentGoalValues(
  admin: Admin,
  athleteId: string,
  sport: string,
): Promise<GoalValues | null> {
  const res = await admin
    .from("athlete_goals")
    .select("current_level_key, season_goal_key, long_term_goal")
    .eq("athlete_id", athleteId)
    .eq("sport", sport)
    .maybeSingle();
  if (res.error) dbError(res.error);
  if (!res.data) return null;
  return {
    currentLevelKey: res.data.current_level_key,
    seasonGoalKey: res.data.season_goal_key,
    longTermGoal: res.data.long_term_goal ?? "",
  };
}

export interface GoalsHistoryRow {
  sport: string;
  changed_by_role: string;
  current_level_key: string;
  season_goal_key: string;
  long_term_goal: string;
  created_at: string;
}

/**
 * Pure: from one athlete's history rows (any order), per sport, who saved
 * last and — when the other author's latest version differs from that —
 * the other version. A sport with rows from one author only never differs.
 */
export function authorshipFromRows(rows: GoalsHistoryRow[]): Map<string, GoalsAuthorship> {
  const bySport = new Map<string, GoalsHistoryRow[]>();
  for (const r of rows) {
    const arr = bySport.get(r.sport) ?? [];
    arr.push(r);
    bySport.set(r.sport, arr);
  }
  const out = new Map<string, GoalsAuthorship>();
  for (const [sport, list] of bySport) {
    const sorted = [...list].sort((x, y) => y.created_at.localeCompare(x.created_at));
    const latest = sorted[0];
    const latestRole = latest.changed_by_role as GoalsAuthorRole;
    const other = sorted.find((r) => r.changed_by_role !== latest.changed_by_role);
    const values = (r: GoalsHistoryRow): GoalValues => ({
      currentLevelKey: r.current_level_key,
      seasonGoalKey: r.season_goal_key,
      longTermGoal: r.long_term_goal ?? "",
    });
    const differsFrom: GoalsOtherVersion | null =
      other && goalsDiffer(values(other), values(latest))
        ? { role: other.changed_by_role as GoalsAuthorRole, at: other.created_at, ...values(other) }
        : null;
    out.set(sport, { lastSetBy: { role: latestRole, at: latest.created_at }, differsFrom });
  }
  return out;
}

/** Authorship per sport for one athlete, limited to `sports` (empty → nothing read). */
export async function goalsAuthorship(
  admin: Admin,
  athleteId: string,
  sports: string[],
): Promise<Map<string, GoalsAuthorship>> {
  if (sports.length === 0) return new Map();
  const res = await admin
    .from("athlete_goals_history")
    .select("sport, changed_by_role, current_level_key, season_goal_key, long_term_goal, created_at")
    .eq("athlete_id", athleteId)
    .in("sport", sports)
    .order("created_at", { ascending: false });
  if (res.error) dbError(res.error);
  return authorshipFromRows((res.data ?? []) as GoalsHistoryRow[]);
}
