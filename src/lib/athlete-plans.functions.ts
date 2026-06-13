import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import { emptySessionsByState, loadSessionsByPlanIds } from "./plan-sessions.functions";
import type { SessionsByState } from "@/components/plans/flow-state-bars";

type Client = SupabaseClient<Database>;

export type AthletePlanStatus = "active" | "benched";
export type TargetKind = "reps" | "mins";

export interface AthletePlanSummaryDTO {
  id: string;
  title: string;
  status: AthletePlanStatus;
  coachId: string;
  coachName: string;
  sport: string;
  moveCount: number;
  totalMinutes: number;
  updatedAt: string;
  sessionsByState: SessionsByState;
  sessionsTotal: number;
}

export interface AthletePlanMoveDTO {
  id: string;
  position: number;
  name: string;
  description: string;
  cue: string;
  why: string;
  targetKind: TargetKind;
  targetValue: number;
}

export interface AthletePlanDetailDTO {
  id: string;
  title: string;
  notes: string;
  status: AthletePlanStatus;
  athleteId: string;
  athleteFirstName: string;
  coachId: string;
  coachName: string;
  coachFirstName: string;
  moveCount: number;
  totalMinutes: number;
  updatedAt: string;
  moves: AthletePlanMoveDTO[];
}

async function getMyAthleteRow(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("athletes")
    .select("id, first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw new Error("Athlete profile not found");
  return data;
}

/* ---------------- list ---------------- */

export const listAthletePlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = context.supabase as Client;
    const athlete = await getMyAthleteRow(supabase, context.userId);

    const { data: planRows, error: pErr } = await supabase
      .from("plans")
      .select("id, title, status, coach_id, updated_at")
      .eq("athlete_id", athlete.id)
      .eq("kind", "plan")
      .in("status", ["active", "benched"])
      .order("updated_at", { ascending: false });
    if (pErr) dbError(pErr);

    const plans = planRows ?? [];
    if (!plans.length) {
      return {
        athlete: { id: athlete.id, firstName: athlete.first_name },
        plans: [] as AthletePlanSummaryDTO[],
      };
    }

    const planIds = plans.map((p) => p.id);
    const coachIds = Array.from(new Set(plans.map((p) => p.coach_id)));

    const [movesRes, coachesRes, goalsRes] = await Promise.all([
      supabase
        .from("plan_moves")
        .select("plan_id, target_kind, target_value, move_id")
        .in("plan_id", planIds),
      supabaseAdmin
        .from("coach_profiles")
        .select("id, first_name, last_name")
        .in("id", coachIds),
      supabaseAdmin
        .from("athlete_goals")
        .select("coach_id, sport")
        .eq("athlete_id", athlete.id)
        .in("coach_id", coachIds),
    ]);
    if (movesRes.error) dbError(movesRes.error);
    if (coachesRes.error) dbError(coachesRes.error);
    if (goalsRes.error) dbError(goalsRes.error);

    // Fallback: look up sport via moves.sport when a plan has no matching goal.
    const moveIds = Array.from(
      new Set((movesRes.data ?? []).map((m) => m.move_id).filter((v): v is string => !!v)),
    );
    let moveSport = new Map<string, string>();
    if (moveIds.length) {
      const mvRes = await supabaseAdmin
        .from("moves")
        .select("id, sport")
        .in("id", moveIds);
      if (mvRes.error) dbError(mvRes.error);
      moveSport = new Map((mvRes.data ?? []).map((m) => [m.id, m.sport]));
    }

    const agg = new Map<string, { count: number; minutes: number; firstMoveSport: string }>();
    for (const m of movesRes.data ?? []) {
      const cur = agg.get(m.plan_id) ?? { count: 0, minutes: 0, firstMoveSport: "" };
      cur.count += 1;
      if (m.target_kind === "mins") cur.minutes += Number(m.target_value);
      if (!cur.firstMoveSport && m.move_id) {
        cur.firstMoveSport = moveSport.get(m.move_id) ?? "";
      }
      agg.set(m.plan_id, cur);
    }

    const coachName = new Map<string, string>();
    for (const c of coachesRes.data ?? []) {
      coachName.set(c.id, `${c.first_name} ${c.last_name}`.trim());
    }

    const coachSport = new Map<string, string>();
    for (const g of goalsRes.data ?? []) {
      if (!g.coach_id) continue;
      if (!coachSport.has(g.coach_id)) coachSport.set(g.coach_id, g.sport);
    }

    const sessionsByPlan = await loadSessionsByPlanIds(supabase, planIds);

    const result: AthletePlanSummaryDTO[] = plans.map((p) => {
      const a = agg.get(p.id) ?? { count: 0, minutes: 0, firstMoveSport: "" };
      const sessions = sessionsByPlan.get(p.id) ?? {
        sessionsByState: emptySessionsByState(),
        sessionsTotal: 0,
      };
      const sport = coachSport.get(p.coach_id) || a.firstMoveSport || "";
      return {
        id: p.id,
        title: p.title || "Untitled plan",
        status: p.status as AthletePlanStatus,
        coachId: p.coach_id,
        coachName: coachName.get(p.coach_id) ?? "Coach",
        sport,
        moveCount: a.count,
        totalMinutes: a.minutes,
        updatedAt: p.updated_at,
        sessionsByState: sessions.sessionsByState,
        sessionsTotal: sessions.sessionsTotal,
      };
    });

    return {
      athlete: { id: athlete.id, firstName: athlete.first_name },
      plans: result,
    };
  });

/* ---------------- detail ---------------- */

export const getAthletePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = context.supabase as Client;
    const athlete = await getMyAthleteRow(supabase, context.userId);

    const { data: plan, error } = await supabase
      .from("plans")
      .select("id, title, notes, status, athlete_id, coach_id, updated_at, kind")
      .eq("id", data.id)
      .maybeSingle();
    if (error) dbError(error);
    if (!plan || plan.kind !== "plan" || plan.athlete_id !== athlete.id) {
      throw new Error("Plan not found");
    }
    if (plan.status !== "active" && plan.status !== "benched") {
      throw new Error("Plan not found");
    }

    const [movesRes, coachRes] = await Promise.all([
      supabase
        .from("plan_moves")
        .select("id, position, name, description, cue, why, target_kind, target_value")
        .eq("plan_id", plan.id)
        .order("position", { ascending: true }),
      supabaseAdmin
        .from("coach_profiles")
        .select("first_name, last_name")
        .eq("id", plan.coach_id)
        .maybeSingle(),
    ]);
    if (movesRes.error) dbError(movesRes.error);
    if (coachRes.error) dbError(coachRes.error);

    const moves: AthletePlanMoveDTO[] = (movesRes.data ?? []).map((m) => ({
      id: m.id,
      position: m.position,
      name: m.name,
      description: m.description,
      cue: m.cue,
      why: m.why,
      targetKind: m.target_kind as TargetKind,
      targetValue: Number(m.target_value),
    }));

    const totalMinutes = moves
      .filter((m) => m.targetKind === "mins")
      .reduce((s, m) => s + m.targetValue, 0);

    const coachFirst = coachRes.data?.first_name ?? "Coach";
    const coachLast = coachRes.data?.last_name ?? "";

    const dto: AthletePlanDetailDTO = {
      id: plan.id,
      title: plan.title || "Untitled plan",
      notes: plan.notes,
      status: plan.status as AthletePlanStatus,
      athleteId: plan.athlete_id,
      athleteFirstName: athlete.first_name,
      coachId: plan.coach_id,
      coachName: `${coachFirst} ${coachLast}`.trim(),
      coachFirstName: coachFirst,
      moveCount: moves.length,
      totalMinutes,
      updatedAt: plan.updated_at,
      moves,
    };

    return { plan: dto };
  });
