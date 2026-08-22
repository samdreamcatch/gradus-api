import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import { getSuggestedHours } from "./coach-sports";
import type { ParentGoalSportDTO } from "./parent-goals.functions";

type Client = SupabaseClient<Database>;

const updateLongTermGoalSchema = z.object({
  sport: z.string().min(1).max(64),
  longTermGoal: z.string().trim().max(280),
});

export const updateAthleteLongTermGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateLongTermGoalSchema.parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    const { data: athlete, error: aErr } = await supabase
      .from("athletes")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (aErr) dbError(aErr);
    if (!athlete) throw new Error("Athlete not found");

    const { error } = await supabase
      .from("athlete_goals")
      .update({ long_term_goal: data.longTermGoal })
      .eq("athlete_id", athlete.id)
      .eq("sport", data.sport);
    if (error) dbError(error);
    return { ok: true };
  });

export interface AthleteGoalsDashboardDTO {
  athleteId: string;
  athleteName: string;
  motivation: string;
  sports: ParentGoalSportDTO[];
}

const updateMotivationSchema = z.object({
  motivation: z.string().trim().max(500),
});

export const updateAthleteMotivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateMotivationSchema.parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    const { error } = await supabase
      .from("athletes")
      .update({ motivation: data.motivation })
      .eq("user_id", context.userId);
    if (error) dbError(error);
    return { ok: true };
  });

export const getAthleteGoalsDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AthleteGoalsDashboardDTO | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = context.supabase as Client;

    const { data: athlete, error: aErr } = await supabase
      .from("athletes")
      .select("id, first_name, last_name, motivation")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (aErr) dbError(aErr);
    if (!athlete) return null;

    const [goalsRes, primaryRes, sessionsRes, firstSessionsRes] = await Promise.all([
      supabase
        .from("athlete_goals")
        .select("sport, current_level_key, season_goal_key, long_term_goal")
        .eq("athlete_id", athlete.id),
      supabase
        .from("athlete_primary_coaches")
        .select("sport, coach_id")
        .eq("athlete_id", athlete.id),
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
      const { data: levels, error: lErr } = await supabaseAdmin
        .from("coach_levels")
        .select("coach_id, sport, level_key, practice_hours_per_week")
        .in("coach_id", coachIds);
      if (lErr) dbError(lErr);
      for (const l of levels ?? []) {
        hoursByKey.set(
          `${l.coach_id}|${l.sport}|${l.level_key}`,
          Number(l.practice_hours_per_week),
        );
      }
    }

    // Per-athlete coach overrides beat the coach's per-level defaults.
    const overrideBySport = new Map<string, number>();
    if (coachIds.length) {
      const { data: targets, error: tErr } = await supabaseAdmin
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
  });
