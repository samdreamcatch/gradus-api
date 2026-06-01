import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import { emptySessionsByState, loadSessionsByPlanIds } from "./plan-sessions.functions";
import type { SessionsByState } from "@/components/plans/flow-state-bars";

type Client = SupabaseClient<Database>;

export type ParentPlanStatus = "active" | "benched";
export type TargetKind = "reps" | "mins";

export interface ParentAthleteOptionDTO {
  id: string;
  name: string;
}

export interface ParentPlanSummaryDTO {
  id: string;
  title: string;
  status: ParentPlanStatus;
  athleteId: string;
  athleteName: string;
  coachId: string;
  coachName: string;
  moveCount: number;
  totalMinutes: number;
  updatedAt: string;
  // TODO(sessions): populate from a real sessions table once persisted.
  sessionsByState: SessionsByState;
  sessionsTotal: number;
}

export interface ParentPlanMoveDTO {
  id: string;
  position: number;
  name: string;
  description: string;
  cue: string;
  why: string;
  targetKind: TargetKind;
  targetValue: number;
}

export interface ParentPlanDetailDTO {
  id: string;
  title: string;
  notes: string;
  status: ParentPlanStatus;
  athleteId: string;
  athleteFirstName: string;
  coachName: string;
  coachFirstName: string;
  moveCount: number;
  totalMinutes: number;
  updatedAt: string;
  moves: ParentPlanMoveDTO[];
}

async function getParentId(supabase: Client, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("parent_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw new Error("Parent profile not found");
  return data.id;
}

/* ---------------- list ---------------- */

export const listParentPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Client;
    const parentId = await getParentId(supabase, context.userId);

    const { data: athleteRows, error: aErr } = await supabase
      .from("athletes")
      .select("id, first_name, last_name")
      .eq("parent_id", parentId);
    if (aErr) dbError(aErr);

    const athletes: ParentAthleteOptionDTO[] = (athleteRows ?? [])
      .map((a) => ({
        id: a.id,
        name: `${a.first_name} ${a.last_name}`.trim(),
      }))
      .sort((x, y) => x.name.localeCompare(y.name));

    if (!athletes.length) {
      return { athletes, plans: [] as ParentPlanSummaryDTO[] };
    }

    const athleteIds = athletes.map((a) => a.id);

    const { data: planRows, error: pErr } = await supabase
      .from("plans")
      .select("id, title, status, athlete_id, coach_id, updated_at")
      .in("athlete_id", athleteIds)
      .eq("kind", "plan")
      .in("status", ["active", "benched"])
      .order("updated_at", { ascending: false });
    if (pErr) dbError(pErr);

    const plans = planRows ?? [];
    if (!plans.length) {
      return { athletes, plans: [] as ParentPlanSummaryDTO[] };
    }

    const planIds = plans.map((p) => p.id);
    const coachIds = Array.from(new Set(plans.map((p) => p.coach_id)));

    const [movesRes, coachesRes] = await Promise.all([
      supabase
        .from("plan_moves")
        .select("plan_id, target_kind, target_value")
        .in("plan_id", planIds),
      supabaseAdmin
        .from("coach_profiles")
        .select("id, first_name, last_name")
        .in("id", coachIds),
    ]);
    if (movesRes.error) dbError(movesRes.error);
    if (coachesRes.error) dbError(coachesRes.error);

    const agg = new Map<string, { count: number; minutes: number }>();
    for (const m of movesRes.data ?? []) {
      const cur = agg.get(m.plan_id) ?? { count: 0, minutes: 0 };
      cur.count += 1;
      if (m.target_kind === "mins") cur.minutes += Number(m.target_value);
      agg.set(m.plan_id, cur);
    }

    const athleteName = new Map(athletes.map((a) => [a.id, a.name]));
    const coachName = new Map<string, string>();
    for (const c of coachesRes.data ?? []) {
      coachName.set(c.id, `${c.first_name} ${c.last_name}`.trim());
    }

    const sessionsByPlan = await loadSessionsByPlanIds(
      supabase,
      plans.filter((p) => p.athlete_id).map((p) => p.id),
    );

    const result: ParentPlanSummaryDTO[] = plans
      .filter((p) => p.athlete_id)
      .map((p) => {
        const a = agg.get(p.id) ?? { count: 0, minutes: 0 };
        const sessions = sessionsByPlan.get(p.id) ?? {
          sessionsByState: emptySessionsByState(),
          sessionsTotal: 0,
        };
        return {
          id: p.id,
          title: p.title || "Untitled plan",
          status: p.status as ParentPlanStatus,
          athleteId: p.athlete_id as string,
          athleteName: athleteName.get(p.athlete_id as string) ?? "",
          coachName: coachName.get(p.coach_id) ?? "Coach",
          moveCount: a.count,
          totalMinutes: a.minutes,
          updatedAt: p.updated_at,
          sessionsByState: sessions.sessionsByState,
          sessionsTotal: sessions.sessionsTotal,
        };
      });

    return { athletes, plans: result };
  });

/* ---------------- detail ---------------- */

export const getParentPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;

    const { data: plan, error } = await supabase
      .from("plans")
      .select("id, title, notes, status, athlete_id, coach_id, updated_at, kind")
      .eq("id", data.id)
      .maybeSingle();
    if (error) dbError(error);
    if (!plan || plan.kind !== "plan" || !plan.athlete_id) {
      throw new Error("Plan not found");
    }
    if (plan.status !== "active" && plan.status !== "benched") {
      throw new Error("Plan not found");
    }

    const [movesRes, athleteRes, coachRes] = await Promise.all([
      supabase
        .from("plan_moves")
        .select("id, position, name, description, cue, why, target_kind, target_value")
        .eq("plan_id", plan.id)
        .order("position", { ascending: true }),
      supabase
        .from("athletes")
        .select("first_name")
        .eq("id", plan.athlete_id)
        .maybeSingle(),
      supabaseAdmin
        .from("coach_profiles")
        .select("first_name, last_name")
        .eq("id", plan.coach_id)
        .maybeSingle(),
    ]);
    if (movesRes.error) dbError(movesRes.error);
    if (athleteRes.error) dbError(athleteRes.error);
    if (coachRes.error) dbError(coachRes.error);

    const moves: ParentPlanMoveDTO[] = (movesRes.data ?? []).map((m) => ({
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

    const dto: ParentPlanDetailDTO = {
      id: plan.id,
      title: plan.title || "Untitled plan",
      notes: plan.notes,
      status: plan.status as ParentPlanStatus,
      athleteId: plan.athlete_id,
      athleteFirstName: athleteRes.data?.first_name ?? "",
      coachName: `${coachFirst} ${coachLast}`.trim(),
      coachFirstName: coachFirst,
      moveCount: moves.length,
      totalMinutes,
      updatedAt: plan.updated_at,
      moves,
    };

    return { plan: dto };
  });
