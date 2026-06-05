import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import type { ParentGoalSportDTO } from "./parent-goals.functions";

type Client = SupabaseClient<Database>;

export interface AthleteGoalsDashboardDTO {
  athleteId: string;
  athleteName: string;
  sports: ParentGoalSportDTO[];
}

export const getAthleteGoalsDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AthleteGoalsDashboardDTO | null> => {
    const supabase = context.supabase as Client;

    const { data: athlete, error: aErr } = await supabase
      .from("athletes")
      .select("id, first_name, last_name")
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

    const sports: ParentGoalSportDTO[] = (goalsRes.data ?? []).map((g) => {
      const coachId = primaryBySport.get(g.sport) ?? null;
      const hoursAtCurrent = coachId
        ? hoursByKey.get(`${coachId}|${g.sport}|${g.current_level_key}`) ?? null
        : null;
      const hoursAtGoal = coachId
        ? hoursByKey.get(`${coachId}|${g.sport}|${g.season_goal_key}`) ?? null
        : null;
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
      sports,
    };
  });
