import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import { getSportLevel } from "./coach-sports";

export type AthletePracticeSummary = {
  athleteId: string;
  hoursLogged: number;
  expectedHoursPerWeek: number | null;
  seasonGoalLabel: string | null;
  /** state_index per session, newest first, capped to recent 20. 0=frustrated..4=flowing */
  sessionStates: number[];
  sessionCount: number;
  windowDays: number;
};

const WINDOW_DAYS = 7;

export const getRosterPracticeSummaries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AthletePracticeSummary[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const coach = await supabaseAdmin
      .from("coach_profiles")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (coach.error) dbError(coach.error);
    if (!coach.data) return [];
    const coachId = coach.data.id;

    const links = await supabaseAdmin
      .from("coach_athletes")
      .select("athlete_id")
      .eq("coach_id", coachId);
    if (links.error) dbError(links.error);
    const athleteIds = (links.data ?? []).map((r) => r.athlete_id as string);
    if (athleteIds.length === 0) return [];

    const [plansRes, goalsRes, levelsRes] = await Promise.all([
      supabaseAdmin
        .from("plans")
        .select("id, athlete_id")
        .eq("coach_id", coachId)
        .eq("kind", "plan")
        .eq("status", "active")
        .in("athlete_id", athleteIds),
      supabaseAdmin
        .from("athlete_goals")
        .select("athlete_id, sport, season_goal_key")
        .eq("coach_id", coachId)
        .in("athlete_id", athleteIds),
      supabaseAdmin
        .from("coach_levels")
        .select("sport, level_key, practice_hours_per_week")
        .eq("coach_id", coachId),
    ]);
    if (plansRes.error) dbError(plansRes.error);
    if (goalsRes.error) dbError(goalsRes.error);
    if (levelsRes.error) dbError(levelsRes.error);

    const planByAthlete = new Map<string, string>();
    for (const p of plansRes.data ?? []) {
      planByAthlete.set(p.athlete_id as string, p.id as string);
    }

    const expectedByKey = new Map<string, number>();
    for (const l of levelsRes.data ?? []) {
      expectedByKey.set(
        `${l.sport}::${l.level_key}`,
        Number(l.practice_hours_per_week),
      );
    }

    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const planIds = Array.from(planByAthlete.values());

    let sessions: Array<{
      athlete_id: string;
      duration_seconds: number;
      state_index: number;
      logged_at: string;
    }> = [];
    if (planIds.length > 0) {
      const sRes = await supabaseAdmin
        .from("plan_sessions")
        .select("athlete_id, duration_seconds, state_index, logged_at")
        .in("plan_id", planIds)
        .gte("logged_at", since)
        .order("logged_at", { ascending: false });
      if (sRes.error) dbError(sRes.error);
      sessions = (sRes.data ?? []) as typeof sessions;
    }

    const sessionsByAthlete = new Map<
      string,
      { secs: number; states: number[] }
    >();
    for (const s of sessions) {
      const cur = sessionsByAthlete.get(s.athlete_id) ?? { secs: 0, states: [] };
      cur.secs += s.duration_seconds;
      cur.states.push(s.state_index);
      sessionsByAthlete.set(s.athlete_id, cur);
    }

    return athleteIds.map((athleteId) => {
      const agg = sessionsByAthlete.get(athleteId);
      const goal = (goalsRes.data ?? []).find((g) => g.athlete_id === athleteId);
      const expected = goal
        ? (expectedByKey.get(`${goal.sport}::${goal.season_goal_key}`) ?? null)
        : null;
      const seasonGoalLabel = goal
        ? (getSportLevel(goal.sport, goal.season_goal_key)?.label ?? null)
        : null;
      return {
        athleteId,
        hoursLogged: agg ? agg.secs / 3600 : 0,
        expectedHoursPerWeek: expected,
        seasonGoalLabel,
        sessionStates: agg ? agg.states.slice(0, 20) : [],
        sessionCount: agg ? agg.states.length : 0,
        windowDays: WINDOW_DAYS,
      };
    });
  });
