/**
 * Goals history (Mariah, 2026-09-20): who set an athlete's goals and what
 * they replaced, so a coach can see when the parent and the athlete want
 * different things.
 *
 * `athlete_goals` is one row per (athlete, sport), last writer wins, with no
 * author. Every write path — the parent's `setParentAthleteGoals`, the
 * athlete's `saveAdultAthleteGoals`, and since 2026-10-27 (decision #60) the
 * coach's starting levels at invite (`addAthleteWithGuardian`,
 * `commitScheduleImport`) — calls `recordGoalsChange` after its upsert; the
 * coach's athlete detail calls `goalsAuthorship` to decorate each goal with
 * who set it last and, when the other person's most recent goals differ
 * from what is saved now, that other version.
 *
 * The "different goals" rule is between the parent and the athlete only. A
 * coach-authored row is a suggestion the family starts from: it shows as
 * "set by the coach" until someone in the family saves, and it never counts
 * as the other version the family disagrees with.
 *
 * Service role only: the table has RLS on with no policies (migration
 * 20260920210000), so every call here takes the admin client.
 */
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dbError } from "./db-error";

type Admin = typeof supabaseAdmin;

export type GoalsAuthorRole = "parent" | "athlete" | "coach";

/** The two people whose goals can disagree (`differsFrom`); a coach's row never does. */
export type GoalsFamilyRole = "parent" | "athlete";

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
  role: GoalsFamilyRole;
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
 *
 * One exception to "unless nothing changed": when the goal on file is still
 * the coach's starting levels (the latest history row is the coach's) and a
 * parent or athlete saves them as they are, that acceptance is recorded, so
 * the coach's detail stops saying "Set by you" and the sign-up step stops
 * saying "Suggested by Coach" (decision #60).
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
  if (args.previous && !goalsDiffer(args.previous, args.next)) {
    if (args.role === "coach" || !(await latestAuthorIsCoach(admin, args.athleteId, args.sport))) {
      return;
    }
  }
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

/** Whether the newest history row for (athlete, sport) is the coach's starting levels. */
async function latestAuthorIsCoach(
  admin: Admin,
  athleteId: string,
  sport: string,
): Promise<boolean> {
  const res = await admin
    .from("athlete_goals_history")
    .select("changed_by_role")
    .eq("athlete_id", athleteId)
    .eq("sport", sport)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) dbError(res.error);
  return res.data?.changed_by_role === "coach";
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

/**
 * The coach's starting levels at invite (decision #60): the athlete's first
 * `athlete_goals` row for the sport, with an empty long-term goal, stamped
 * with this coach and recorded as a `coach` change. Only ever a first row —
 * when the family (or an earlier import) already saved goals for the sport,
 * nothing is written: a suggestion never overwrites what someone chose.
 * Returns whether a row was written.
 */
export async function applyCoachStartingLevels(
  admin: Admin,
  args: {
    athleteId: string;
    sport: string;
    coachId: string;
    coachUserId: string;
    currentLevelKey: string;
    seasonGoalKey: string;
  },
): Promise<boolean> {
  const previous = await currentGoalValues(admin, args.athleteId, args.sport);
  if (previous) return false;
  const next: GoalValues = {
    currentLevelKey: args.currentLevelKey,
    seasonGoalKey: args.seasonGoalKey,
    longTermGoal: "",
  };
  // History first: if its CHECK refuses `coach` (migration 20261027170000 not
  // yet applied), nothing has been written and the levels are simply dropped,
  // never left in athlete_goals without attribution.
  await recordGoalsChange(admin, {
    athleteId: args.athleteId,
    sport: args.sport,
    role: "coach",
    userId: args.coachUserId,
    next,
    previous: null,
  });
  const up = await admin.from("athlete_goals").upsert(
    {
      athlete_id: args.athleteId,
      coach_id: args.coachId,
      sport: args.sport,
      current_level_key: next.currentLevelKey,
      season_goal_key: next.seasonGoalKey,
      long_term_goal: next.longTermGoal,
    },
    { onConflict: "athlete_id,sport" },
  );
  if (up.error) dbError(up.error);
  return true;
}

/**
 * For a sign-up goals step: the goals on file per sport for one athlete, and
 * — when the latest history row for that sport is the coach's — the coach's
 * name, so the client can say "Suggested by Coach <name>". The name comes
 * from the goal row's `coach_id`; a coach row with no profile (deleted) is
 * still a suggestion, with no name.
 */
export interface PrefilledGoal extends GoalValues {
  sport: string;
  /** Set when the goal on file is the coach's starting levels nobody in the family has changed yet. */
  suggestedByCoachName: string | null;
  /** True whenever the latest author is the coach, even if the name could not be resolved. */
  suggestedByCoach: boolean;
}

export async function prefilledGoalsForAthletes(
  admin: Admin,
  athleteIds: string[],
): Promise<Map<string, PrefilledGoal[]>> {
  const out = new Map<string, PrefilledGoal[]>();
  if (athleteIds.length === 0) return out;
  const goals = await admin
    .from("athlete_goals")
    .select(
      "athlete_id, sport, coach_id, current_level_key, season_goal_key, long_term_goal, created_at",
    )
    .in("athlete_id", athleteIds);
  if (goals.error) dbError(goals.error);
  const rows = goals.data ?? [];
  if (rows.length === 0) return out;

  const history = await admin
    .from("athlete_goals_history")
    .select("athlete_id, sport, changed_by_role, created_at")
    .in("athlete_id", athleteIds)
    .order("created_at", { ascending: false });
  if (history.error) dbError(history.error);
  // Latest author per (athlete, sport), in the current goal's era: rows from
  // before the goal now on file was created belong to a deleted earlier goal
  // (same floor as `authorshipFromRows`).
  const since = new Map(rows.map((g) => [`${g.athlete_id}::${g.sport}`, g.created_at as string]));
  const latestRole = new Map<string, string>();
  for (const h of history.data ?? []) {
    const k = `${h.athlete_id}::${h.sport}`;
    const floor = since.get(k);
    if (floor && (h.created_at as string) < floor) continue;
    if (!latestRole.has(k)) latestRole.set(k, h.changed_by_role as string);
  }

  const coachIds = Array.from(
    new Set(
      rows
        .filter((g) => latestRole.get(`${g.athlete_id}::${g.sport}`) === "coach" && g.coach_id)
        .map((g) => g.coach_id as string),
    ),
  );
  const names = new Map<string, string>();
  if (coachIds.length > 0) {
    const profiles = await admin
      .from("coach_profiles")
      .select("id, first_name, last_name")
      .in("id", coachIds);
    if (profiles.error) dbError(profiles.error);
    for (const cp of profiles.data ?? []) {
      names.set(cp.id as string, `${cp.first_name} ${cp.last_name}`.trim());
    }
  }

  for (const g of rows) {
    const byCoach = latestRole.get(`${g.athlete_id}::${g.sport}`) === "coach";
    const arr = out.get(g.athlete_id as string) ?? [];
    arr.push({
      sport: g.sport as string,
      currentLevelKey: g.current_level_key as string,
      seasonGoalKey: g.season_goal_key as string,
      longTermGoal: (g.long_term_goal as string | null) ?? "",
      suggestedByCoach: byCoach,
      suggestedByCoachName:
        byCoach && g.coach_id ? (names.get(g.coach_id as string) ?? null) : null,
    });
    out.set(g.athlete_id as string, arr);
  }
  return out;
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
 * Only the parent and the athlete can be "the other author": a coach's
 * starting levels (decision #60) are credited as last set when they are the
 * latest row, but never surface as a version the family disagrees with.
 *
 * `since[sport]` is the current athlete_goals row's `created_at`: goals are
 * deleted when a coach is unlinked (and on account deletion) while history
 * stays, so rows older than the row now on file belong to an earlier era and
 * are ignored. Without a floor every row counts.
 */
export function authorshipFromRows(
  rows: GoalsHistoryRow[],
  since: Record<string, string> = {},
): Map<string, GoalsAuthorship> {
  const bySport = new Map<string, GoalsHistoryRow[]>();
  for (const r of rows) {
    const floor = since[r.sport];
    if (floor && r.created_at < floor) continue;
    const arr = bySport.get(r.sport) ?? [];
    arr.push(r);
    bySport.set(r.sport, arr);
  }
  const out = new Map<string, GoalsAuthorship>();
  for (const [sport, list] of bySport) {
    const sorted = [...list].sort((x, y) => y.created_at.localeCompare(x.created_at));
    const latest = sorted[0];
    const latestRole = latest.changed_by_role as GoalsAuthorRole;
    const other = sorted.find(
      (r) => r.changed_by_role !== latest.changed_by_role && r.changed_by_role !== "coach",
    );
    const values = (r: GoalsHistoryRow): GoalValues => ({
      currentLevelKey: r.current_level_key,
      seasonGoalKey: r.season_goal_key,
      longTermGoal: r.long_term_goal ?? "",
    });
    const differsFrom: GoalsOtherVersion | null =
      other && goalsDiffer(values(other), values(latest))
        ? { role: other.changed_by_role as GoalsFamilyRole, at: other.created_at, ...values(other) }
        : null;
    out.set(sport, { lastSetBy: { role: latestRole, at: latest.created_at }, differsFrom });
  }
  return out;
}

/**
 * Authorship per sport for one athlete. `goals` are the athlete_goals rows on
 * file (sport + created_at), which bound both the sports read and the era
 * considered; empty → nothing read.
 */
export async function goalsAuthorship(
  admin: Admin,
  athleteId: string,
  goals: { sport: string; created_at: string }[],
): Promise<Map<string, GoalsAuthorship>> {
  const sports = goals.map((g) => g.sport);
  if (sports.length === 0) return new Map();
  const since = Object.fromEntries(goals.map((g) => [g.sport, g.created_at]));
  const res = await admin
    .from("athlete_goals_history")
    .select(
      "sport, changed_by_role, current_level_key, season_goal_key, long_term_goal, created_at",
    )
    .eq("athlete_id", athleteId)
    .in("sport", sports)
    .order("created_at", { ascending: false });
  if (res.error) dbError(res.error);
  return authorshipFromRows((res.data ?? []) as GoalsHistoryRow[], since);
}
