import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type PlanKind = "plan" | "template";
export type PlanStatus = "active" | "benched" | "draft";
export type TargetKind = "reps" | "minutes";

type Client = SupabaseClient<Database>;

async function getCoachId(supabase: Client, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Coach profile not found");
  return data.id;
}

export interface PlanMoveDTO {
  id: string;
  position: number;
  moveId: string | null;
  name: string;
  description: string;
  cue: string;
  why: string;
  targetKind: TargetKind;
  targetValue: number;
}

export interface PlanSummaryDTO {
  id: string;
  title: string;
  kind: PlanKind;
  status: PlanStatus;
  athleteId: string | null;
  athleteName: string | null;
  moveCount: number;
  totalMinutes: number;
  updatedAt: string;
}

export interface PlanDetailDTO extends PlanSummaryDTO {
  notes: string;
  moves: PlanMoveDTO[];
}

export interface AthleteOptionDTO {
  id: string;
  name: string;
}

/* ---------------- roster ---------------- */

export const listCoachAthletes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);
    const { data, error } = await supabase
      .from("coach_athletes")
      .select("athlete_id, athletes!inner(id, first_name, last_name)")
      .eq("coach_id", coachId);
    if (error) throw new Error(error.message);
    const athletes: AthleteOptionDTO[] = (data ?? []).map((row) => {
      const a = (row as unknown as { athletes: { id: string; first_name: string; last_name: string } }).athletes;
      return { id: a.id, name: `${a.first_name} ${a.last_name}`.trim() };
    });
    athletes.sort((a, b) => a.name.localeCompare(b.name));
    return { athletes };
  });

/* ---------------- list plans ---------------- */

const listInput = z.object({
  status: z.enum(["active", "benched", "draft"]).optional(),
  athleteId: z.string().uuid().optional(),
  kind: z.enum(["plan", "template"]).optional(),
});

export const listPlans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => listInput.parse(input ?? {}))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);

    let q = supabase
      .from("plans")
      .select("id, title, kind, status, athlete_id, updated_at")
      .eq("coach_id", coachId)
      .order("updated_at", { ascending: false });

    if (data.kind) q = q.eq("kind", data.kind);
    if (data.status) q = q.eq("status", data.status);
    if (data.athleteId) q = q.eq("athlete_id", data.athleteId);

    const { data: plans, error } = await q;
    if (error) throw new Error(error.message);

    const planIds = (plans ?? []).map((p) => p.id);
    const athleteIds = Array.from(
      new Set((plans ?? []).map((p) => p.athlete_id).filter((x): x is string => !!x)),
    );

    const [movesRes, athletesRes] = await Promise.all([
      planIds.length
        ? supabase
            .from("plan_moves")
            .select("plan_id, target_kind, target_value")
            .in("plan_id", planIds)
        : Promise.resolve({ data: [], error: null }),
      athleteIds.length
        ? supabase
            .from("athletes")
            .select("id, first_name, last_name")
            .in("id", athleteIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (movesRes.error) throw new Error(movesRes.error.message);
    if (athletesRes.error) throw new Error(athletesRes.error.message);

    const byPlan = new Map<string, { count: number; minutes: number }>();
    for (const m of movesRes.data ?? []) {
      const cur = byPlan.get(m.plan_id) ?? { count: 0, minutes: 0 };
      cur.count += 1;
      if (m.target_kind === "minutes") cur.minutes += Number(m.target_value);
      byPlan.set(m.plan_id, cur);
    }

    const nameOf = new Map<string, string>();
    for (const a of athletesRes.data ?? []) {
      nameOf.set(a.id, `${a.first_name} ${a.last_name}`.trim());
    }

    const result: PlanSummaryDTO[] = (plans ?? []).map((p) => {
      const agg = byPlan.get(p.id) ?? { count: 0, minutes: 0 };
      return {
        id: p.id,
        title: p.title,
        kind: p.kind as PlanKind,
        status: p.status as PlanStatus,
        athleteId: p.athlete_id,
        athleteName: p.athlete_id ? (nameOf.get(p.athlete_id) ?? null) : null,
        moveCount: agg.count,
        totalMinutes: agg.minutes,
        updatedAt: p.updated_at,
      };
    });

    return { plans: result };
  });

/* ---------------- get plan ---------------- */

export const getPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);

    const { data: plan, error } = await supabase
      .from("plans")
      .select("id, title, notes, kind, status, athlete_id, updated_at")
      .eq("id", data.id)
      .eq("coach_id", coachId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!plan) throw new Error("Plan not found");

    const { data: moves, error: movesErr } = await supabase
      .from("plan_moves")
      .select("id, position, move_id, name, description, cue, why, target_kind, target_value")
      .eq("plan_id", plan.id)
      .order("position", { ascending: true });
    if (movesErr) throw new Error(movesErr.message);

    let athleteName: string | null = null;
    if (plan.athlete_id) {
      const { data: a } = await supabase
        .from("athletes")
        .select("first_name, last_name")
        .eq("id", plan.athlete_id)
        .maybeSingle();
      if (a) athleteName = `${a.first_name} ${a.last_name}`.trim();
    }

    const planMoves: PlanMoveDTO[] = (moves ?? []).map((m) => ({
      id: m.id,
      position: m.position,
      moveId: m.move_id,
      name: m.name,
      description: m.description,
      cue: m.cue,
      why: m.why,
      targetKind: m.target_kind as TargetKind,
      targetValue: Number(m.target_value),
    }));

    const totalMinutes = planMoves
      .filter((m) => m.targetKind === "minutes")
      .reduce((s, m) => s + m.targetValue, 0);

    const dto: PlanDetailDTO = {
      id: plan.id,
      title: plan.title,
      notes: plan.notes,
      kind: plan.kind as PlanKind,
      status: plan.status as PlanStatus,
      athleteId: plan.athlete_id,
      athleteName,
      moveCount: planMoves.length,
      totalMinutes,
      updatedAt: plan.updated_at,
      moves: planMoves,
    };

    return { plan: dto };
  });

/* ---------------- save plan ---------------- */

const saveInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(160),
  notes: z.string().max(4000).default(""),
  kind: z.enum(["plan", "template"]),
  athleteId: z.string().uuid().nullable().optional(),
  moves: z.array(
    z.object({
      moveId: z.string().uuid().nullable().optional(),
      name: z.string().min(1).max(160),
      description: z.string().max(2000).default(""),
      cue: z.string().max(1000).default(""),
      why: z.string().max(1000).default(""),
      targetKind: z.enum(["reps", "minutes"]),
      targetValue: z.number().min(0).max(10000),
    }),
  ).max(200),
});

export const savePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => saveInput.parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);

    if (data.kind === "plan" && !data.athleteId) {
      throw new Error("Assign plan to an athlete or save it as a template.");
    }

    const planRow = {
      coach_id: coachId,
      title: data.title,
      notes: data.notes,
      kind: data.kind,
      athlete_id: data.kind === "template" ? null : (data.athleteId ?? null),
      updated_at: new Date().toISOString(),
    };

    let planId = data.id;
    if (planId) {
      const { error } = await supabase
        .from("plans")
        .update(planRow)
        .eq("id", planId)
        .eq("coach_id", coachId);
      if (error) throw new Error(error.message);
    } else {
      const { data: inserted, error } = await supabase
        .from("plans")
        .insert({ ...planRow, status: "benched" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      planId = inserted.id;
    }

    // Replace plan_moves
    const { error: delErr } = await supabase
      .from("plan_moves")
      .delete()
      .eq("plan_id", planId);
    if (delErr) throw new Error(delErr.message);

    if (data.moves.length) {
      const rows = data.moves.map((m, i) => ({
        plan_id: planId!,
        position: i,
        move_id: m.moveId ?? null,
        name: m.name,
        description: m.description,
        cue: m.cue,
        why: m.why,
        target_kind: m.targetKind,
        target_value: m.targetValue,
      }));
      const { error: insErr } = await supabase.from("plan_moves").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }

    return { id: planId! };
  });

/* ---------------- status / delete / duplicate ---------------- */

export const setPlanStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["active", "benched", "draft"]),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);

    if (data.status === "active") {
      const { data: owned, error: ownErr } = await supabase
        .from("plans")
        .select("id, athlete_id")
        .eq("id", data.id)
        .eq("coach_id", coachId)
        .maybeSingle();
      if (ownErr) throw new Error(ownErr.message);
      if (!owned) throw new Error("Plan not found");
      if (!owned.athlete_id) throw new Error("Assign an athlete before activating.");
      const { error } = await supabase.rpc("activate_plan", { _plan_id: data.id });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("plans")
        .update({ status: data.status })
        .eq("id", data.id)
        .eq("coach_id", coachId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deletePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);
    await supabase.from("plan_moves").delete().eq("plan_id", data.id);
    const { error } = await supabase
      .from("plans")
      .delete()
      .eq("id", data.id)
      .eq("coach_id", coachId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const createInput = z.object({
  kind: z.enum(["plan", "template"]).default("plan"),
  athleteId: z.string().uuid().nullable().optional(),
  fromPlanId: z.string().uuid().optional(),
  fromTemplateId: z.string().uuid().optional(),
  title: z.string().min(1).max(160).optional(),
});

export const createPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createInput.parse(input ?? {}))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);

    const sourceId = data.fromPlanId ?? data.fromTemplateId;
    let title = data.title ?? "Untitled plan";
    let notes = "";
    let sourceMoves: Array<{
      position: number;
      move_id: string | null;
      name: string;
      description: string;
      cue: string;
      why: string;
      target_kind: string;
      target_value: number;
    }> = [];

    if (sourceId) {
      const { data: src, error } = await supabase
        .from("plans")
        .select("title, notes")
        .eq("id", sourceId)
        .eq("coach_id", coachId)
        .single();
      if (error) throw new Error(error.message);
      title = data.title ?? (src.title ? `${src.title} (copy)` : title);
      notes = src.notes;
      const { data: srcMoves, error: mErr } = await supabase
        .from("plan_moves")
        .select("position, move_id, name, description, cue, why, target_kind, target_value")
        .eq("plan_id", sourceId)
        .order("position", { ascending: true });
      if (mErr) throw new Error(mErr.message);
      sourceMoves = srcMoves ?? [];
    }

    const { data: inserted, error: insErr } = await supabase
      .from("plans")
      .insert({
        coach_id: coachId,
        title,
        notes,
        kind: data.kind,
        athlete_id: data.kind === "template" ? null : (data.athleteId ?? null),
        status: data.kind === "template" ? "benched" : "draft",
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    if (sourceMoves.length) {
      const rows = sourceMoves.map((m, i) => ({
        plan_id: inserted.id,
        position: i,
        move_id: m.move_id,
        name: m.name,
        description: m.description,
        cue: m.cue,
        why: m.why,
        target_kind: m.target_kind,
        target_value: m.target_value,
      }));
      const { error: pmErr } = await supabase.from("plan_moves").insert(rows);
      if (pmErr) throw new Error(pmErr.message);
    }

    return { id: inserted.id };
  });

/* ---------------- add move to plan ---------------- */

export const addMoveToPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ planId: z.string().uuid(), moveId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);

    const { data: plan, error: planErr } = await supabase
      .from("plans")
      .select("id, title, coach_id")
      .eq("id", data.planId)
      .maybeSingle();
    if (planErr) throw new Error(planErr.message);
    if (!plan || plan.coach_id !== coachId) throw new Error("Plan not found");

    const { data: move, error: moveErr } = await supabase
      .from("moves")
      .select("id, name, description, cue, why, default_target_kind, default_target_value")
      .eq("id", data.moveId)
      .maybeSingle();
    if (moveErr) throw new Error(moveErr.message);
    if (!move) throw new Error("Move not found");

    const { data: last, error: posErr } = await supabase
      .from("plan_moves")
      .select("position")
      .eq("plan_id", plan.id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (posErr) throw new Error(posErr.message);
    const nextPos = (last?.position ?? -1) + 1;

    const { error: insErr } = await supabase.from("plan_moves").insert({
      plan_id: plan.id,
      move_id: move.id,
      position: nextPos,
      name: move.name,
      description: move.description,
      cue: move.cue,
      why: move.why,
      target_kind: move.default_target_kind,
      target_value: move.default_target_value,
    });
    if (insErr) throw new Error(insErr.message);

    await supabase
      .from("plans")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", plan.id);

    return { planId: plan.id, planTitle: plan.title || "Untitled plan" };
  });

/* ---------------- per-field plan updates ---------------- */

async function assertPlanOwned(supabase: Client, planId: string, coachId: string) {
  const { data, error } = await supabase
    .from("plans")
    .select("id, kind, status, athlete_id")
    .eq("id", planId)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Plan not found");
  return data;
}

const updatePlanInput = z.object({
  id: z.string().uuid(),
  title: z.string().max(160).optional(),
  notes: z.string().max(4000).optional(),
  kind: z.enum(["plan", "template"]).optional(),
  athleteId: z.string().uuid().nullable().optional(),
});

export const updatePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updatePlanInput.parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);
    await assertPlanOwned(supabase, data.id, coachId);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.title !== undefined) patch.title = data.title;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.kind !== undefined) {
      patch.kind = data.kind;
      if (data.kind === "template") patch.athlete_id = null;
    }
    if (data.athleteId !== undefined) patch.athlete_id = data.athleteId;

    const { error } = await supabase
      .from("plans")
      .update(patch)
      .eq("id", data.id)
      .eq("coach_id", coachId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- per-move plan updates ---------------- */

const planMovePatch = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  cue: z.string().max(1000).optional(),
  why: z.string().max(1000).optional(),
  targetKind: z.enum(["reps", "minutes"]).optional(),
  targetValue: z.number().min(0).max(10000).optional(),
});

export const updatePlanMove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), patch: planMovePatch }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);

    // verify ownership through plan_id
    const { data: pm, error: pmErr } = await supabase
      .from("plan_moves")
      .select("plan_id")
      .eq("id", data.id)
      .maybeSingle();
    if (pmErr) throw new Error(pmErr.message);
    if (!pm) throw new Error("Plan move not found");
    await assertPlanOwned(supabase, pm.plan_id, coachId);

    const row: Record<string, unknown> = {};
    if (data.patch.name !== undefined) row.name = data.patch.name;
    if (data.patch.description !== undefined) row.description = data.patch.description;
    if (data.patch.cue !== undefined) row.cue = data.patch.cue;
    if (data.patch.why !== undefined) row.why = data.patch.why;
    if (data.patch.targetKind !== undefined) row.target_kind = data.patch.targetKind;
    if (data.patch.targetValue !== undefined) row.target_value = data.patch.targetValue;

    const { error } = await supabase
      .from("plan_moves")
      .update(row)
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await supabase
      .from("plans")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", pm.plan_id);

    return { ok: true };
  });

export const removePlanMove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);

    const { data: pm, error: pmErr } = await supabase
      .from("plan_moves")
      .select("plan_id")
      .eq("id", data.id)
      .maybeSingle();
    if (pmErr) throw new Error(pmErr.message);
    if (!pm) return { ok: true };
    await assertPlanOwned(supabase, pm.plan_id, coachId);

    const { error } = await supabase
      .from("plan_moves")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await supabase
      .from("plans")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", pm.plan_id);
    return { ok: true };
  });

export const reorderPlanMoves = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      planId: z.string().uuid(),
      orderedIds: z.array(z.string().uuid()).max(200),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);
    await assertPlanOwned(supabase, data.planId, coachId);

    // Update positions one at a time (small lists; simple + safe under RLS).
    for (let i = 0; i < data.orderedIds.length; i++) {
      const id = data.orderedIds[i];
      const { error } = await supabase
        .from("plan_moves")
        .update({ position: i })
        .eq("id", id)
        .eq("plan_id", data.planId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const addLibraryMovesToPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      planId: z.string().uuid(),
      moveIds: z.array(z.string().uuid()).min(1).max(50),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);
    await assertPlanOwned(supabase, data.planId, coachId);

    const { data: moves, error: mErr } = await supabase
      .from("moves")
      .select("id, name, description, cue, why, default_target_kind, default_target_value")
      .in("id", data.moveIds);
    if (mErr) throw new Error(mErr.message);
    if (!moves?.length) return { inserted: 0 };

    const { data: last, error: posErr } = await supabase
      .from("plan_moves")
      .select("position")
      .eq("plan_id", data.planId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (posErr) throw new Error(posErr.message);
    let nextPos = (last?.position ?? -1) + 1;

    // Preserve the order the caller asked for
    const byId = new Map(moves.map((m) => [m.id, m]));
    const rows = data.moveIds
      .map((id) => byId.get(id))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .map((m) => ({
        plan_id: data.planId,
        move_id: m.id,
        position: nextPos++,
        name: m.name,
        description: m.description,
        cue: m.cue,
        why: m.why,
        target_kind: m.default_target_kind,
        target_value: m.default_target_value,
      }));

    const { error: insErr } = await supabase.from("plan_moves").insert(rows);
    if (insErr) throw new Error(insErr.message);

    await supabase
      .from("plans")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.planId);

    return { inserted: rows.length };
  });
