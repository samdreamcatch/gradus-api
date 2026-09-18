/**
 * The parent's goals dashboard (PRD §7.7 "Goals dashboard"): each accessible
 * athlete with, per sport, the level and season goal, the long-term goal,
 * the primary coach's expected hours, and the trailing 28-day practice
 * numbers — the single source of truth for the web server function
 * (parent-goals.functions.ts) and `GET /api/v1/parent/goals`. Extracted
 * without behavior changes.
 *
 * Reads go through the caller's RLS client, as on the web; the admin client
 * is used only for `coach_levels` and `coach_athlete_practice_targets`
 * (coach-only RLS), scoped strictly to the coaches surfaced through the
 * parent-readable `athlete_primary_coaches` table so no other coach data
 * leaks.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dbError } from "./db-error";
import { getSuggestedHours } from "./coach-sports";
import { guardianAthleteAccess } from "./team.server";

type Client = SupabaseClient<Database>;
type Admin = typeof supabaseAdmin;

export type ParentGoalsContext = { userId: string; supabase: Client; admin: Admin };

export interface ParentGoalSportDTO {
  sport: string;
  currentLevelKey: string;
  seasonGoalKey: string;
  longTermGoal: string;
  primaryCoachId: string | null;
  /** Coach's expected hr/wk at the current level. Null if not set. */
  hoursAtCurrent: number | null;
  /** Coach's expected hr/wk at the season-goal level. Null if not set. */
  hoursAtGoal: number | null;
  /** Trailing 28-day average, expressed in hr/wk. */
  loggedHoursPerWeek: number;
  sessionsCount: number;
  /** ISO timestamp of earliest logged session, or null if none. */
  firstSessionAt: string | null;
}

export interface ParentGoalAthleteDTO {
  athleteId: string;
  athleteName: string;
  sports: ParentGoalSportDTO[];
  /** True for a co-guardian once the primary parent's Team plan has lapsed — `sports` is empty. */
  locked: boolean;
}

/** Every accessible athlete's goals, sorted by name. `[]` when the caller has no parent profile. */
export async function getParentGoalsDashboard(
  ctx: ParentGoalsContext,
): Promise<ParentGoalAthleteDTO[]> {
  const { userId, supabase, admin } = ctx;

  // Resolve parent id
  const { data: parent, error: pErr } = await supabase
    .from("parent_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (pErr) dbError(pErr);
  if (!parent) return [];

  // The plan-active check inside guardianAthleteAccess reads another
  // parent's parent_profiles row (the primary's), which RLS only allows for
  // that parent's own auth.uid() — so this one lookup goes through the admin
  // client even though the rest of this function stays on the caller's RLS
  // client.
  const access = await guardianAthleteAccess(admin as any, parent.id);
  const lockedById = new Map(access.map((a) => [a.athleteId, a.locked]));
  const accessibleIds = access.length
    ? access.map((a) => a.athleteId)
    : ["00000000-0000-0000-0000-000000000000"];
  const { data: athleteRows, error: aErr } = await supabase
    .from("athletes")
    .select("id, first_name, last_name")
    .in("id", accessibleIds);
  if (aErr) dbError(aErr);
  if (!athleteRows?.length) return [];

  const athleteIds = athleteRows.map((a) => a.id);

  const [goalsRes, primaryRes, sessionsRes] = await Promise.all([
    supabase
      .from("athlete_goals")
      .select("athlete_id, sport, current_level_key, season_goal_key, long_term_goal")
      .in("athlete_id", athleteIds),
    supabase
      .from("athlete_primary_coaches")
      .select("athlete_id, sport, coach_id")
      .in("athlete_id", athleteIds),
    supabase
      .from("plan_sessions")
      .select("athlete_id, duration_seconds, logged_at")
      .in("athlete_id", athleteIds)
      .gte("logged_at", new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString()),
  ]);
  if (goalsRes.error) dbError(goalsRes.error);
  if (primaryRes.error) dbError(primaryRes.error);
  if (sessionsRes.error) dbError(sessionsRes.error);

  // Earliest session per athlete (any time) — used for the "building up" rule
  const { data: firstSessions, error: fsErr } = await supabase
    .from("plan_sessions")
    .select("athlete_id, logged_at")
    .in("athlete_id", athleteIds)
    .order("logged_at", { ascending: true });
  if (fsErr) dbError(fsErr);
  const firstSessionAt = new Map<string, string>();
  for (const s of firstSessions ?? []) {
    if (!firstSessionAt.has(s.athlete_id)) firstSessionAt.set(s.athlete_id, s.logged_at);
  }

  // Sum trailing 28-day duration & count per athlete
  const trailing = new Map<string, { seconds: number; count: number }>();
  for (const s of sessionsRes.data ?? []) {
    const cur = trailing.get(s.athlete_id) ?? { seconds: 0, count: 0 };
    cur.seconds += s.duration_seconds;
    cur.count += 1;
    trailing.set(s.athlete_id, cur);
  }

  // Primary coach lookup map keyed by (athleteId|sport)
  const primaryByKey = new Map<string, string>();
  for (const p of primaryRes.data ?? []) {
    primaryByKey.set(`${p.athlete_id}|${p.sport}`, p.coach_id);
  }

  // Fetch coach_levels via admin client (coach-only RLS otherwise). We scope
  // strictly to the coach_ids surfaced via the parent-readable
  // athlete_primary_coaches table, so no other coach data leaks.
  const coachIds = Array.from(new Set(primaryRes.data?.map((p) => p.coach_id) ?? []));
  const hoursByKey = new Map<string, number>(); // `${coach_id}|${sport}|${level_key}` -> hours
  if (coachIds.length) {
    const { data: levels, error: lErr } = await admin
      .from("coach_levels")
      .select("coach_id, sport, level_key, practice_hours_per_week")
      .in("coach_id", coachIds);
    if (lErr) dbError(lErr);
    for (const l of levels ?? []) {
      hoursByKey.set(`${l.coach_id}|${l.sport}|${l.level_key}`, Number(l.practice_hours_per_week));
    }
  }

  // Per-athlete coach overrides beat the coach's per-level defaults.
  const overrideByKey = new Map<string, number>(); // `${athlete_id}|${sport}` -> hours
  if (coachIds.length && athleteRows.length) {
    const { data: targets, error: tErr } = await admin
      .from("coach_athlete_practice_targets")
      .select("athlete_id, sport, hours_per_week, coach_id")
      .in("coach_id", coachIds)
      .in(
        "athlete_id",
        athleteRows.map((a) => a.id),
      );
    if (tErr) dbError(tErr);
    for (const t of targets ?? []) {
      if (primaryByKey.get(`${t.athlete_id}|${t.sport}`) !== t.coach_id) continue;
      overrideByKey.set(`${t.athlete_id}|${t.sport}`, Number(t.hours_per_week));
    }
  }

  // Build DTO per athlete
  type GoalRow = NonNullable<typeof goalsRes.data>[number];
  const goalsByAthlete = new Map<string, GoalRow[]>();
  for (const g of goalsRes.data ?? []) {
    const arr = goalsByAthlete.get(g.athlete_id) ?? [];
    arr.push(g);
    goalsByAthlete.set(g.athlete_id, arr);
  }

  const result: ParentGoalAthleteDTO[] = athleteRows
    .map((a) => {
      if (lockedById.get(a.id)) {
        return {
          athleteId: a.id,
          athleteName: `${a.first_name} ${a.last_name}`.trim(),
          sports: [],
          locked: true,
        };
      }

      const goals = goalsByAthlete.get(a.id) ?? [];
      const sports: ParentGoalSportDTO[] = goals.map((g) => {
        const coachId = primaryByKey.get(`${a.id}|${g.sport}`) ?? null;
        const override = overrideByKey.get(`${a.id}|${g.sport}`) ?? null;
        // Override → primary coach's level hours → Gradus default, so an
        // athlete without a coach still sees an expectation.
        const hoursAtCurrent =
          override ??
          (coachId ? hoursByKey.get(`${coachId}|${g.sport}|${g.current_level_key}`) : undefined) ??
          getSuggestedHours(g.sport, g.current_level_key);
        const hoursAtGoal =
          override ??
          (coachId ? hoursByKey.get(`${coachId}|${g.sport}|${g.season_goal_key}`) : undefined) ??
          getSuggestedHours(g.sport, g.season_goal_key);
        const t = trailing.get(a.id) ?? { seconds: 0, count: 0 };
        const hrsPerWeek = t.seconds / 3600 / 4;
        return {
          sport: g.sport,
          currentLevelKey: g.current_level_key,
          seasonGoalKey: g.season_goal_key,
          longTermGoal: g.long_term_goal,
          primaryCoachId: coachId,
          hoursAtCurrent,
          hoursAtGoal,
          loggedHoursPerWeek: Math.round(hrsPerWeek * 10) / 10,
          sessionsCount: t.count,
          firstSessionAt: firstSessionAt.get(a.id) ?? null,
        };
      });
      return {
        athleteId: a.id,
        athleteName: `${a.first_name} ${a.last_name}`.trim(),
        sports,
        locked: false,
      };
    })
    .sort((x, y) => x.athleteName.localeCompare(y.athleteName));

  return result;
}
