/**
 * The athlete's own goals dashboard (PRD §7.7 "Goals dashboard", §7.8):
 * their sports with level, season goal, long-term goal, the primary coach's
 * expected hours and the trailing 28-day practice numbers, plus the two
 * self-edits (long-term goal per sport, motivation) — the single source of
 * truth for the web server functions (athlete-goals.functions.ts) and the
 * `/api/v1/athlete/goals*` routes. Extracted without behavior changes;
 * user-facing messages are kept verbatim on ApiError.
 *
 * Reads and writes go through the caller's RLS client, as on the web; the
 * admin client is used only for `coach_levels` and
 * `coach_athlete_practice_targets` (coach-only RLS), scoped to the athlete's
 * own primary coaches.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { getSuggestedHours } from "./coach-sports";
import type { ParentGoalSportDTO } from "./parent-goals.server";

type Client = SupabaseClient<Database>;
type Admin = typeof supabaseAdmin;

export type AthleteGoalsContext = { userId: string; supabase: Client; admin: Admin };

const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });

export interface AthleteGoalsDashboardDTO {
  athleteId: string;
  athleteName: string;
  motivation: string;
  sports: ParentGoalSportDTO[];
}

export const longTermGoalInput = z.object({
  sport: z.string().min(1).max(64),
  longTermGoal: z.string().trim().max(280),
});
export type LongTermGoalInput = z.infer<typeof longTermGoalInput>;

export const motivationInput = z.object({
  motivation: z.string().trim().max(500),
});
export type MotivationInput = z.infer<typeof motivationInput>;

/** Set the long-term goal for one of the caller's sports. */
export async function updateAthleteLongTermGoal(
  ctx: Pick<AthleteGoalsContext, "userId" | "supabase">,
  input: LongTermGoalInput,
): Promise<{ ok: true }> {
  const { userId, supabase } = ctx;
  const { data: athlete, error: aErr } = await supabase
    .from("athletes")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (aErr) dbError(aErr);
  if (!athlete) throw notFound("Athlete not found");

  const { error } = await supabase
    .from("athlete_goals")
    .update({ long_term_goal: input.longTermGoal })
    .eq("athlete_id", athlete.id)
    .eq("sport", input.sport);
  if (error) dbError(error);
  return { ok: true };
}

/** Set the caller's motivation line. */
export async function updateAthleteMotivation(
  ctx: Pick<AthleteGoalsContext, "userId" | "supabase">,
  input: MotivationInput,
): Promise<{ ok: true }> {
  const { userId, supabase } = ctx;
  const { error } = await supabase
    .from("athletes")
    .update({ motivation: input.motivation })
    .eq("user_id", userId);
  if (error) dbError(error);
  return { ok: true };
}

/** The caller's dashboard, or null when they have no athlete row. */
export async function getAthleteGoalsDashboard(
  ctx: AthleteGoalsContext,
): Promise<AthleteGoalsDashboardDTO | null> {
  const { userId, supabase, admin } = ctx;

  const { data: athlete, error: aErr } = await supabase
    .from("athletes")
    .select("id, first_name, last_name, motivation")
    .eq("user_id", userId)
    .maybeSingle();
  if (aErr) dbError(aErr);
  if (!athlete) return null;

  const [goalsRes, primaryRes, sessionsRes, firstSessionsRes] = await Promise.all([
    supabase
      .from("athlete_goals")
      .select("sport, current_level_key, season_goal_key, long_term_goal")
      .eq("athlete_id", athlete.id),
    supabase.from("athlete_primary_coaches").select("sport, coach_id").eq("athlete_id", athlete.id),
    supabase
      .from("plan_sessions")
      .select("duration_seconds, logged_at")
      .eq("athlete_id", athlete.id)
      .gte("logged_at", new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString()),
    supabase
      .from("plan_sessions")
      .select("logged_at")
      .eq("athlete_id", athlete.id)
      .order("logged_at", { ascending: true })
      .limit(1),
  ]);
  if (goalsRes.error) dbError(goalsRes.error);
  if (primaryRes.error) dbError(primaryRes.error);
  if (sessionsRes.error) dbError(sessionsRes.error);
  if (firstSessionsRes.error) dbError(firstSessionsRes.error);

  const firstSessionAt = firstSessionsRes.data?.[0]?.logged_at ?? null;

  let totalSeconds = 0;
  let count = 0;
  for (const s of sessionsRes.data ?? []) {
    totalSeconds += s.duration_seconds;
    count += 1;
  }
  const hrsPerWeek = totalSeconds / 3600 / 4;

  const primaryBySport = new Map<string, string>();
  for (const p of primaryRes.data ?? []) {
    primaryBySport.set(p.sport, p.coach_id);
  }

  const coachIds = Array.from(new Set(primaryRes.data?.map((p) => p.coach_id) ?? []));
  const hoursByKey = new Map<string, number>();
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
  const overrideBySport = new Map<string, number>();
  if (coachIds.length) {
    const { data: targets, error: tErr } = await admin
      .from("coach_athlete_practice_targets")
      .select("sport, hours_per_week, coach_id")
      .in("coach_id", coachIds)
      .eq("athlete_id", athlete.id);
    if (tErr) dbError(tErr);
    for (const t of targets ?? []) {
      if (primaryBySport.get(t.sport) !== t.coach_id) continue;
      overrideBySport.set(t.sport, Number(t.hours_per_week));
    }
  }

  const sports: ParentGoalSportDTO[] = (goalsRes.data ?? []).map((g) => {
    const coachId = primaryBySport.get(g.sport) ?? null;
    const override = overrideBySport.get(g.sport) ?? null;
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
    return {
      sport: g.sport,
      currentLevelKey: g.current_level_key,
      seasonGoalKey: g.season_goal_key,
      longTermGoal: g.long_term_goal,
      primaryCoachId: coachId,
      hoursAtCurrent,
      hoursAtGoal,
      loggedHoursPerWeek: Math.round(hrsPerWeek * 10) / 10,
      sessionsCount: count,
      firstSessionAt,
    };
  });

  return {
    athleteId: athlete.id,
    athleteName: `${athlete.first_name} ${athlete.last_name}`.trim(),
    motivation: athlete.motivation ?? "",
    sports,
  };
}
