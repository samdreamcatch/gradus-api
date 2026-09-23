/**
 * Coach plans (PRD §7.3): list with filters, detail, whole-plan save,
 * per-field updates, moves inside a plan, status with the max-active rule,
 * delete, create/clone, and an athlete's active plans. Single source of
 * truth for plans.functions.ts and the `/api/v1/coach/plans` and
 * `/api/v1/plans/{id}` routes. Reads and writes go through the caller's RLS
 * client, as on the web; errors are `ApiError`s that the web wrapper turns
 * back into its original plain messages.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import type { SessionsByState } from "@/components/plans/flow-state-bars";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { emptySessionsByState, loadSessionsByPlanIds } from "./plan-sessions.server";
import { skillReasonSchema, type ReasonMove, type SkillReason } from "./skill-events.server";

export type PlanKind = "plan" | "template";
export type PlanStatus = "active" | "benched" | "draft";
export type TargetKind = "reps" | "mins";

type Client = SupabaseClient<Database>;

export type PlansContext = { userId: string; supabase: Client };

export const MAX_ACTIVE_PLANS_PER_ATHLETE = 2;

const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });
const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });

/** The caller's coach id, creating the profile on first use; parents are refused. */
export async function ensureCoachId(supabase: Client, userId: string): Promise<string> {
  const existing = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.error) dbError(existing.error);
  if (existing.data) return existing.data.id;

  // Don't silently convert a parent into a coach.
  const parent = await supabase
    .from("parent_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (parent.error) dbError(parent.error);
  if (parent.data) {
    throw new ApiError({
      code: "wrong_role",
      status: 403,
      message: "This account is registered as a parent, not a coach.",
    });
  }

  const created = await supabase
    .from("coach_profiles")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (created.error) dbError(created.error);
  return created.data.id;
}

export interface LibraryMoveSnapshotDTO {
  id: string;
  name: string;
  description: string;
  cue: string;
  why: string;
  defaultTargetKind: TargetKind;
  defaultTargetValue: number;
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
  libraryMove: LibraryMoveSnapshotDTO | null;
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
  sessionsByState: SessionsByState;
  sessionsTotal: number;
}

export interface PlanDetailDTO extends PlanSummaryDTO {
  notes: string;
  moves: PlanMoveDTO[];
  voiceTranscript: string | null;
  /** False when another coach who shares the athlete is reading it. */
  isOwner: boolean;
}

export interface AthleteOptionDTO {
  id: string;
  name: string;
}

export interface ActivationConflict {
  kind: "needs_confirm" | "needs_bench_choice";
  activePlans: { id: string; title: string }[];
}

/* ---------------- roster helpers ---------------- */

export async function listCoachAthletes(ctx: PlansContext): Promise<AthleteOptionDTO[]> {
  const coachId = await ensureCoachId(ctx.supabase, ctx.userId);
  const { data, error } = await ctx.supabase
    .from("coach_athletes")
    .select("athlete_id, athletes!inner(id, first_name, last_name)")
    .eq("coach_id", coachId);
  if (error) dbError(error);
  const athletes: AthleteOptionDTO[] = (data ?? []).map((row) => {
    const a = (
      row as unknown as { athletes: { id: string; first_name: string; last_name: string } }
    ).athletes;
    return { id: a.id, name: `${a.first_name} ${a.last_name}`.trim() };
  });
  athletes.sort((a, b) => a.name.localeCompare(b.name));
  return athletes;
}

export async function listCoachSports(ctx: PlansContext): Promise<string[]> {
  const coachId = await ensureCoachId(ctx.supabase, ctx.userId);
  const { data, error } = await ctx.supabase
    .from("coach_levels")
    .select("sport")
    .eq("coach_id", coachId);
  if (error) dbError(error);
  return Array.from(new Set((data ?? []).map((r) => r.sport))).sort();
}

/* ---------------- list plans ---------------- */

export const listPlansInput = z.object({
  status: z.enum(["active", "benched", "draft"]).optional(),
  athleteId: z.string().uuid().optional(),
  kind: z.enum(["plan", "template"]).optional(),
  sport: z.string().optional(),
});

export async function listPlans(
  ctx: PlansContext,
  data: z.infer<typeof listPlansInput>,
): Promise<PlanSummaryDTO[]> {
  const supabase = ctx.supabase;
  const coachId = await ensureCoachId(supabase, ctx.userId);

  let q = supabase
    .from("plans")
    .select("id, title, kind, status, athlete_id, updated_at")
    .eq("coach_id", coachId)
    .order("updated_at", { ascending: false });

  if (data.kind) q = q.eq("kind", data.kind);
  if (data.status) q = q.eq("status", data.status);
  if (data.athleteId) q = q.eq("athlete_id", data.athleteId);

  const { data: plans, error } = await q;
  if (error) dbError(error);

  const planIds = (plans ?? []).map((p) => p.id);
  const athleteIds = Array.from(
    new Set((plans ?? []).map((p) => p.athlete_id).filter((x): x is string => !!x)),
  );

  const [movesRes, athletesRes, goalsRes] = await Promise.all([
    planIds.length
      ? supabase
          .from("plan_moves")
          .select("plan_id, target_kind, target_value, move_id")
          .in("plan_id", planIds)
      : Promise.resolve({ data: [], error: null }),
    athleteIds.length
      ? supabase.from("athletes").select("id, first_name, last_name").in("id", athleteIds)
      : Promise.resolve({ data: [], error: null }),
    data.sport && athleteIds.length
      ? supabase.from("athlete_goals").select("athlete_id, sport").in("athlete_id", athleteIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (movesRes.error) dbError(movesRes.error);
  if (athletesRes.error) dbError(athletesRes.error);
  if (goalsRes.error) dbError(goalsRes.error);

  // When filtering by sport, look up each referenced move's sport in a second query.
  const moveSportMap = new Map<string, string>();
  if (data.sport) {
    const moveIds = Array.from(
      new Set((movesRes.data ?? []).map((m) => m.move_id).filter((x): x is string => !!x)),
    );
    if (moveIds.length) {
      const { data: moveRows, error: moveErr } = await supabase
        .from("moves")
        .select("id, sport")
        .in("id", moveIds);
      if (moveErr) dbError(moveErr);
      for (const m of moveRows ?? []) moveSportMap.set(m.id, m.sport);
    }
  }

  const byPlan = new Map<string, { count: number; minutes: number; sports: Set<string> }>();
  for (const m of movesRes.data ?? []) {
    const cur = byPlan.get(m.plan_id) ?? { count: 0, minutes: 0, sports: new Set<string>() };
    cur.count += 1;
    if (m.target_kind === "mins") cur.minutes += Number(m.target_value);
    const sp = m.move_id ? moveSportMap.get(m.move_id) : undefined;
    if (sp) cur.sports.add(sp);
    byPlan.set(m.plan_id, cur);
  }

  const athleteSport = new Map<string, Set<string>>();
  for (const g of goalsRes.data ?? []) {
    if (!athleteSport.has(g.athlete_id)) athleteSport.set(g.athlete_id, new Set());
    athleteSport.get(g.athlete_id)!.add(g.sport);
  }

  const nameOf = new Map<string, string>();
  for (const a of athletesRes.data ?? []) {
    nameOf.set(a.id, `${a.first_name} ${a.last_name}`.trim());
  }

  let filteredPlans = plans ?? [];
  if (data.sport) {
    const wanted = data.sport;
    filteredPlans = filteredPlans.filter((p) => {
      const fromMoves = byPlan.get(p.id)?.sports.has(wanted) ?? false;
      const fromAthlete = p.athlete_id
        ? (athleteSport.get(p.athlete_id)?.has(wanted) ?? false)
        : false;
      return fromMoves || fromAthlete;
    });
  }

  const sessionsByPlan = await loadSessionsByPlanIds(
    supabase,
    filteredPlans.map((p) => p.id),
  );

  return filteredPlans.map((p) => {
    const agg = byPlan.get(p.id) ?? { count: 0, minutes: 0 };
    const sessions = sessionsByPlan.get(p.id) ?? {
      sessionsByState: emptySessionsByState(),
      sessionsTotal: 0,
    };
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
      sessionsByState: sessions.sessionsByState,
      sessionsTotal: sessions.sessionsTotal,
    };
  });
}

/* ---------------- get plan ---------------- */

export async function getPlan(ctx: PlansContext, id: string): Promise<PlanDetailDTO> {
  const supabase = ctx.supabase;
  const coachId = await ensureCoachId(supabase, ctx.userId);

  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, title, notes, kind, status, athlete_id, updated_at, voice_transcript, coach_id")
    .eq("id", id)
    .maybeSingle();
  if (error) dbError(error);
  if (!plan) throw notFound("Plan not found");

  // Allow: (a) owner coach, or (b) another coach who shares this athlete.
  const isOwner = plan.coach_id === coachId;
  if (!isOwner) {
    if (!plan.athlete_id) throw notFound("Plan not found");
    const { data: shared } = await supabase
      .from("coach_athletes")
      .select("coach_id")
      .eq("coach_id", coachId)
      .eq("athlete_id", plan.athlete_id)
      .maybeSingle();
    if (!shared) throw notFound("Plan not found");
  }

  const { data: moves, error: movesErr } = await supabase
    .from("plan_moves")
    .select("id, position, move_id, name, description, cue, why, target_kind, target_value")
    .eq("plan_id", plan.id)
    .order("position", { ascending: true });
  if (movesErr) dbError(movesErr);

  let athleteName: string | null = null;
  if (plan.athlete_id) {
    const { data: a } = await supabase
      .from("athletes")
      .select("first_name, last_name")
      .eq("id", plan.athlete_id)
      .maybeSingle();
    if (a) athleteName = `${a.first_name} ${a.last_name}`.trim();
  }

  // Load library snapshots for any linked moves so the client can detect edits.
  const linkedMoveIds = Array.from(
    new Set((moves ?? []).map((m) => m.move_id).filter((x): x is string => !!x)),
  );
  const libSnapshot = new Map<string, LibraryMoveSnapshotDTO>();
  if (linkedMoveIds.length) {
    const { data: libRows, error: libErr } = await supabase
      .from("moves")
      .select("id, name, description, cue, why, default_target_kind, default_target_value")
      .in("id", linkedMoveIds)
      .eq("coach_id", coachId);
    if (libErr) dbError(libErr);
    for (const r of libRows ?? []) {
      libSnapshot.set(r.id, {
        id: r.id,
        name: r.name,
        description: r.description ?? "",
        cue: r.cue ?? "",
        why: r.why ?? "",
        defaultTargetKind: r.default_target_kind as TargetKind,
        defaultTargetValue: Number(r.default_target_value),
      });
    }
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
    libraryMove: m.move_id ? (libSnapshot.get(m.move_id) ?? null) : null,
  }));

  const totalMinutes = planMoves
    .filter((m) => m.targetKind === "mins")
    .reduce((s, m) => s + m.targetValue, 0);

  const sessionsMap = await loadSessionsByPlanIds(supabase, [plan.id]);
  const sessions = sessionsMap.get(plan.id) ?? {
    sessionsByState: emptySessionsByState(),
    sessionsTotal: 0,
  };
  return {
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
    voiceTranscript: (plan as { voice_transcript?: string | null }).voice_transcript ?? null,
    sessionsByState: sessions.sessionsByState,
    sessionsTotal: sessions.sessionsTotal,
    isOwner,
  };
}

/* ---------------- save plan ---------------- */

export const savePlanMoveInput = z.object({
  moveId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(160),
  description: z.string().max(2000).default(""),
  cue: z.string().max(1000).default(""),
  why: z.string().max(1000).default(""),
  targetKind: z.enum(["reps", "mins"]),
  targetValue: z.number().min(0).max(10000),
});

export const savePlanInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(160),
  notes: z.string().max(4000).default(""),
  kind: z.enum(["plan", "template"]),
  athleteId: z.string().uuid().nullable().optional(),
  moves: z.array(savePlanMoveInput).max(200),
});

/** Whole-plan write: the row plus a full replacement of its moves. Creates when `id` is absent. */
export async function savePlan(
  ctx: PlansContext,
  data: z.infer<typeof savePlanInput>,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const supabase = ctx.supabase;
  const coachId = await ensureCoachId(supabase, ctx.userId);

  if (data.kind === "plan" && !data.athleteId) {
    throw unprocessable("Assign plan to an athlete or save it as a template.");
  }

  const planRow = {
    coach_id: coachId,
    title: data.title,
    notes: data.notes,
    kind: data.kind,
    athlete_id: data.kind === "template" ? null : (data.athleteId ?? null),
    updated_at: now.toISOString(),
  };

  let planId = data.id;
  if (planId) {
    // Another coach's id must not reach the move replacement below.
    await assertPlanOwned(supabase, planId, coachId);
    const { error } = await supabase
      .from("plans")
      .update(planRow)
      .eq("id", planId)
      .eq("coach_id", coachId);
    if (error) dbError(error);
  } else {
    const { data: inserted, error } = await supabase
      .from("plans")
      .insert({ ...planRow, status: "benched" })
      .select("id")
      .single();
    if (error) dbError(error);
    planId = inserted.id;
  }

  // Replace plan_moves
  const { error: delErr } = await supabase.from("plan_moves").delete().eq("plan_id", planId);
  if (delErr) dbError(delErr);

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
    if (insErr) dbError(insErr);
  }

  return { id: planId! };
}

/* ---------------- status / delete / create ---------------- */

export async function getAthleteActivePlans(
  ctx: PlansContext,
  athleteId: string,
  excludePlanId?: string,
): Promise<{ id: string; title: string }[]> {
  const coachId = await ensureCoachId(ctx.supabase, ctx.userId);
  let q = ctx.supabase
    .from("plans")
    .select("id, title")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId)
    .eq("kind", "plan")
    .eq("status", "active");
  if (excludePlanId) q = q.neq("id", excludePlanId);
  const { data: rows, error } = await q;
  if (error) dbError(error);
  return (rows ?? []) as { id: string; title: string }[];
}

export const setPlanStatusInput = z.object({
  status: z.enum(["active", "benched", "draft"]),
  replaceId: z.string().uuid().optional(),
  /** The coach's answer to the "why" prompt on bench (PRD §7.3, decision #17); ignored for other statuses. */
  reason: skillReasonSchema.optional(),
});

/** What a "why" answer covers: the plan's athlete and the moves the answer is about. */
export interface CoachReasonInput {
  athleteId: string;
  coachId: string;
  userId: string;
  planId: string;
  reason: SkillReason;
  /** The moves the answer covers; omitted for a bench, which covers every move the plan has. */
  moves?: ReasonMove[];
}

/** A bench answer covers the plan; a removal answer (moves given) covers one move. */
const originOf = (input: CoachReasonInput): "bench" | "remove" =>
  input.moves ? "remove" : "bench";

export type RecordCoachReason = (input: CoachReasonInput) => Promise<void>;

/**
 * Writes the skill events for a "why" answer with the admin client (the
 * table is service-role only). Never throws: the bench or removal already
 * happened and must not fail because the learning signal did not land.
 *
 * Owning the plan is not enough: a plan keeps its `athlete_id` after the
 * athlete leaves the roster (or is blocked), and `athlete_id` is writable on
 * the coach's own plan. So the answer only lands when the coach still coaches
 * that athlete, checked here against `coach_athletes`.
 *
 * Dynamic imports keep the admin client out of this module's static graph,
 * which the client bundle reaches (see the push note in `setPlanStatus`).
 */
export const recordCoachReason: RecordCoachReason = async (input) => {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recordCoachReasonEvents } = await import("./skill-events.server");
    const link = await supabaseAdmin
      .from("coach_athletes")
      .select("athlete_id")
      .eq("coach_id", input.coachId)
      .eq("athlete_id", input.athleteId)
      .maybeSingle();
    if (link.error) throw link.error;
    if (!link.data) {
      console.info("[plans] skill event skipped: athlete is not on this coach's roster");
      return;
    }
    let moves = input.moves;
    if (!moves) {
      const pm = await supabaseAdmin
        .from("plan_moves")
        .select("id, move_id, name, created_at")
        .eq("plan_id", input.planId);
      if (pm.error) throw pm.error;
      moves = (pm.data ?? []).map((m) => ({
        planMoveId: m.id,
        moveId: m.move_id,
        name: m.name,
        startedAt: m.created_at,
      }));
    }
    await recordCoachReasonEvents(supabaseAdmin, { ...input, origin: originOf(input), moves });
  } catch (e) {
    console.error("[plans] skill event write failed", e);
  }
};

/**
 * Activation enforces at most `MAX_ACTIVE_PLANS_PER_ATHLETE` active plans per
 * athlete: when the cap is reached and no valid `replaceId` is given, the
 * result is 409 `bench_choice_required` with the active plans in `details`
 * (the web reads it as `BENCH_CHOICE_REQUIRED`).
 */
export async function setPlanStatus(
  ctx: PlansContext,
  id: string,
  data: z.infer<typeof setPlanStatusInput>,
  record: RecordCoachReason = recordCoachReason,
): Promise<{ ok: true }> {
  const supabase = ctx.supabase;
  const coachId = await ensureCoachId(supabase, ctx.userId);

  if (data.status === "active") {
    const { data: owned, error: ownErr } = await supabase
      .from("plans")
      .select("id, athlete_id, title, status")
      .eq("id", id)
      .eq("coach_id", coachId)
      .maybeSingle();
    if (ownErr) dbError(ownErr);
    if (!owned) throw notFound("Plan not found");

    // Athlete-scoped conflict logic only runs when an athlete is assigned.
    // A plan with no athlete is a public/social share and activates directly.
    if (owned.athlete_id) {
      const { data: others, error: othersErr } = await supabase
        .from("plans")
        .select("id, title")
        .eq("coach_id", coachId)
        .eq("athlete_id", owned.athlete_id)
        .eq("kind", "plan")
        .eq("status", "active")
        .neq("id", id);
      if (othersErr) dbError(othersErr);
      const activeOthers = (others ?? []) as { id: string; title: string }[];

      if (activeOthers.length >= MAX_ACTIVE_PLANS_PER_ATHLETE) {
        if (!data.replaceId || !activeOthers.some((p) => p.id === data.replaceId)) {
          throw new ApiError({
            code: "bench_choice_required",
            status: 409,
            message:
              "This athlete already has the maximum number of active plans. Choose one to bench.",
            details: { activePlans: activeOthers },
          });
        }
      }

      if (data.replaceId) {
        if (!activeOthers.some((p) => p.id === data.replaceId)) {
          throw unprocessable("Selected plan is not active.");
        }
        const { error: bErr } = await supabase
          .from("plans")
          .update({ status: "benched" })
          .eq("id", data.replaceId)
          .eq("coach_id", coachId);
        if (bErr) dbError(bErr);
      }
    }

    const { error } = await supabase
      .from("plans")
      .update({ status: "active" })
      .eq("id", id)
      .eq("coach_id", coachId);
    if (error) dbError(error);

    // Guardian-on-file: email a copy of the assignment to an unclaimed
    // guardian, but only on the transition into active.
    if (owned.athlete_id && owned.status !== "active") {
      try {
        const { mirrorGuardianActivity } = await import("./guardian.server");
        await mirrorGuardianActivity({
          athleteId: owned.athlete_id,
          senderRole: "coach",
          coachId,
          body: `Assigned a new plan: ${owned.title ?? "Untitled plan"}`,
        });
      } catch (e) {
        console.error("[plans] guardian plan mirror failed", e);
      }

      // Push the athlete and their guardians (PRD §6.6 "Plan activated or assigned").
      // Dynamic imports: this module is re-exported into the client bundle
      // (MAX_ACTIVE_PLANS_PER_ATHLETE), so the push stack must not join its
      // static import graph — same reason `guardian.server` is imported lazily above.
      const athleteId = owned.athlete_id;
      const planTitle = owned.title ?? "Untitled plan";
      const wasDraft = owned.status === "draft";
      const { inBackground } = await import("./background");
      await inBackground("push:plan-activated", async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { athleteHouseholdUserIds, notifyUsers } = await import("./push-notify.server");
        const recipients = await athleteHouseholdUserIds(supabaseAdmin, athleteId);
        await notifyUsers(supabaseAdmin, recipients, {
          type: "plan_assigned",
          route: `plans/${id}`,
          title: wasDraft ? "New plan" : "Plan activated",
          body: `${planTitle} is ready to practice.`,
          collapseId: `plan:${id}`,
        });
      });
    }
  } else {
    if (data.status === "benched" && data.reason) {
      // A "why" answer only counts on the transition into benched. The
      // conditional update makes that atomic: a replayed request (the iOS
      // outbox), a retry racing the first attempt, or a second tap changes
      // no row and records nothing.
      const { data: changed, error } = await supabase
        .from("plans")
        .update({ status: "benched" })
        .eq("id", id)
        .eq("coach_id", coachId)
        .neq("status", "benched")
        .select("id, athlete_id");
      if (error) dbError(error);
      const plan = (changed ?? [])[0] as { id: string; athlete_id: string | null } | undefined;
      if (plan?.athlete_id) {
        await record({
          athleteId: plan.athlete_id,
          coachId,
          userId: ctx.userId,
          planId: id,
          reason: data.reason,
        });
      }
    } else {
      const { error } = await supabase
        .from("plans")
        .update({ status: data.status })
        .eq("id", id)
        .eq("coach_id", coachId);
      if (error) dbError(error);
    }
  }
  return { ok: true };
}

async function assertPlanOwned(supabase: Client, planId: string, coachId: string) {
  const { data, error } = await supabase
    .from("plans")
    .select("id, kind, status, athlete_id")
    .eq("id", planId)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw notFound("Plan not found");
  return data;
}

/** Only templates, drafts, and benched plans may be hard-deleted; active plans must be benched first. */
export async function deletePlan(ctx: PlansContext, id: string): Promise<{ ok: true }> {
  const supabase = ctx.supabase;
  const coachId = await ensureCoachId(supabase, ctx.userId);

  const plan = await assertPlanOwned(supabase, id, coachId);
  const deletable =
    plan.kind === "template" || plan.status === "draft" || plan.status === "benched";
  if (!deletable) {
    throw new ApiError({
      code: "not_deletable",
      status: 422,
      message: "Active plans can't be deleted — bench the plan first.",
    });
  }

  await supabase.from("plan_moves").delete().eq("plan_id", id);
  const { error } = await supabase.from("plans").delete().eq("id", id).eq("coach_id", coachId);
  if (error) dbError(error);
  return { ok: true };
}

export const createPlanInput = z.object({
  kind: z.enum(["plan", "template"]).default("plan"),
  athleteId: z.string().uuid().nullable().optional(),
  fromPlanId: z.string().uuid().optional(),
  fromTemplateId: z.string().uuid().optional(),
  title: z.string().min(1).max(160).optional(),
});

/** A new draft (or benched template), optionally cloned from one of the coach's plans or templates. */
export async function createPlan(
  ctx: PlansContext,
  data: z.infer<typeof createPlanInput>,
): Promise<{ id: string }> {
  const supabase = ctx.supabase;
  const coachId = await ensureCoachId(supabase, ctx.userId);

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
      .maybeSingle();
    if (error) dbError(error);
    if (!src) throw notFound("Plan not found");
    title = data.title ?? (src.title ? `${src.title} (copy)` : title);
    notes = src.notes;
    const { data: srcMoves, error: mErr } = await supabase
      .from("plan_moves")
      .select("position, move_id, name, description, cue, why, target_kind, target_value")
      .eq("plan_id", sourceId)
      .order("position", { ascending: true });
    if (mErr) dbError(mErr);
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
  if (insErr) dbError(insErr);

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
    if (pmErr) dbError(pmErr);
  }

  return { id: inserted.id };
}

/* ---------------- moves inside a plan ---------------- */

export async function addMoveToPlan(
  ctx: PlansContext,
  planId: string,
  moveId: string,
  now: Date = new Date(),
): Promise<{ planId: string; planTitle: string }> {
  const supabase = ctx.supabase;
  const coachId = await ensureCoachId(supabase, ctx.userId);

  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .select("id, title, coach_id")
    .eq("id", planId)
    .maybeSingle();
  if (planErr) dbError(planErr);
  if (!plan || plan.coach_id !== coachId) throw notFound("Plan not found");

  const { data: move, error: moveErr } = await supabase
    .from("moves")
    .select("id, name, description, cue, why, default_target_kind, default_target_value")
    .eq("id", moveId)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (moveErr) dbError(moveErr);
  if (!move) throw notFound("Move not found");

  const { data: last, error: posErr } = await supabase
    .from("plan_moves")
    .select("position")
    .eq("plan_id", plan.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (posErr) dbError(posErr);
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
  if (insErr) dbError(insErr);

  await supabase.from("plans").update({ updated_at: now.toISOString() }).eq("id", plan.id);

  return { planId: plan.id, planTitle: plan.title || "Untitled plan" };
}

export const updatePlanPatch = z.object({
  title: z.string().max(160).optional(),
  notes: z.string().max(4000).optional(),
  kind: z.enum(["plan", "template"]).optional(),
  athleteId: z.string().uuid().nullable().optional(),
});

/**
 * Per-field update. Reassigning the athlete on an active plan forks it into
 * a new draft (`forkedId`) and leaves the original, and any share token,
 * untouched.
 */
export async function updatePlan(
  ctx: PlansContext,
  id: string,
  data: z.infer<typeof updatePlanPatch>,
  now: Date = new Date(),
): Promise<{ ok: true; forkedId?: string }> {
  const supabase = ctx.supabase;
  const coachId = await ensureCoachId(supabase, ctx.userId);
  await assertPlanOwned(supabase, id, coachId);

  // Load current row so we can keep the kind/status/athlete combination
  // valid per the plans_kind_athlete_chk constraint.
  const { data: current, error: loadErr } = await supabase
    .from("plans")
    .select("kind,status,athlete_id,title,notes")
    .eq("id", id)
    .eq("coach_id", coachId)
    .single();
  if (loadErr || !current) dbError(loadErr, "Plan not found");

  // Fork-on-reassign: if the coach changes the athlete on an active plan,
  // clone into a new draft for the new assignment and leave the original
  // row (and any share_token) untouched.
  const isAthleteChange =
    data.athleteId !== undefined &&
    (data.kind === undefined || data.kind === "plan") &&
    current.kind === "plan" &&
    current.status === "active" &&
    (data.athleteId ?? null) !== (current.athlete_id ?? null);

  if (isAthleteChange) {
    const nextTitle = data.title ?? current.title ?? "Untitled plan";
    const nextNotes = data.notes ?? current.notes ?? "";
    const { data: inserted, error: insErr } = await supabase
      .from("plans")
      .insert({
        coach_id: coachId,
        title: nextTitle,
        notes: nextNotes,
        kind: "plan",
        athlete_id: data.athleteId ?? null,
        status: "draft",
      })
      .select("id")
      .single();
    if (insErr) dbError(insErr);

    const { data: srcMoves, error: mErr } = await supabase
      .from("plan_moves")
      .select("position, move_id, name, description, cue, why, target_kind, target_value")
      .eq("plan_id", id)
      .order("position", { ascending: true });
    if (mErr) dbError(mErr);
    if (srcMoves && srcMoves.length) {
      const rows = srcMoves.map((m, i) => ({
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
      if (pmErr) dbError(pmErr);
    }

    return { ok: true, forkedId: inserted.id as string };
  }

  const patch: {
    updated_at: string;
    title?: string;
    notes?: string;
    kind?: string;
    status?: string;
    athlete_id?: string | null;
  } = { updated_at: now.toISOString() };
  if (data.title !== undefined) patch.title = data.title;
  if (data.notes !== undefined) patch.notes = data.notes;
  if (data.kind !== undefined) {
    patch.kind = data.kind;
    if (data.kind === "template") patch.athlete_id = null;
  }
  if (data.athleteId !== undefined) patch.athlete_id = data.athleteId;

  // Resolve the post-patch shape and reconcile against the constraint.
  const nextKind = patch.kind ?? current.kind;
  const nextAthlete = patch.athlete_id !== undefined ? patch.athlete_id : current.athlete_id;
  const nextStatus = current.status;

  if (nextKind === "template") {
    patch.athlete_id = null;
    patch.status = "draft";
  } else if (nextKind === "plan") {
    if (!nextAthlete) {
      // plan with no athlete must be a draft
      patch.status = "draft";
    } else if (nextStatus === "draft") {
      // assigning an athlete to a draft keeps it as draft until activated
      patch.status = "draft";
    }
  }

  const { error } = await supabase.from("plans").update(patch).eq("id", id).eq("coach_id", coachId);
  if (error) dbError(error);

  return { ok: true };
}

export const planMovePatch = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  cue: z.string().max(1000).optional(),
  why: z.string().max(1000).optional(),
  targetKind: z.enum(["reps", "mins"]).optional(),
  targetValue: z.number().min(0).max(10000).optional(),
});

/** Ownership is verified through the move's plan; `expectedPlanId` (the API's path) must match it too. */
export async function updatePlanMove(
  ctx: PlansContext,
  planMoveId: string,
  patch: z.infer<typeof planMovePatch>,
  expectedPlanId?: string,
  now: Date = new Date(),
): Promise<{ ok: true }> {
  const supabase = ctx.supabase;
  const coachId = await ensureCoachId(supabase, ctx.userId);

  const { data: pm, error: pmErr } = await supabase
    .from("plan_moves")
    .select("plan_id")
    .eq("id", planMoveId)
    .maybeSingle();
  if (pmErr) dbError(pmErr);
  if (!pm || (expectedPlanId && pm.plan_id !== expectedPlanId)) {
    throw notFound("Plan move not found");
  }
  await assertPlanOwned(supabase, pm.plan_id, coachId);

  const row: {
    name?: string;
    description?: string;
    cue?: string;
    why?: string;
    target_kind?: string;
    target_value?: number;
  } = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.cue !== undefined) row.cue = patch.cue;
  if (patch.why !== undefined) row.why = patch.why;
  if (patch.targetKind !== undefined) row.target_kind = patch.targetKind;
  if (patch.targetValue !== undefined) row.target_value = patch.targetValue;

  // Echo the verified plan_id into the WHERE clause so the SQL matches
  // the ownership check above — defense-in-depth against RLS misconfig.
  const { error } = await supabase
    .from("plan_moves")
    .update(row)
    .eq("id", planMoveId)
    .eq("plan_id", pm.plan_id);
  if (error) dbError(error);

  await supabase.from("plans").update({ updated_at: now.toISOString() }).eq("id", pm.plan_id);

  return { ok: true };
}

export async function removePlanMove(
  ctx: PlansContext,
  planMoveId: string,
  expectedPlanId?: string,
  now: Date = new Date(),
  /** The coach's "why" answer (PRD §7.3); absent when skipped or from the web. */
  reason?: SkillReason,
  record: RecordCoachReason = recordCoachReason,
): Promise<{ ok: true }> {
  const supabase = ctx.supabase;
  const coachId = await ensureCoachId(supabase, ctx.userId);

  const { data: pm, error: pmErr } = await supabase
    .from("plan_moves")
    .select("plan_id, move_id, name, created_at")
    .eq("id", planMoveId)
    .maybeSingle();
  if (pmErr) dbError(pmErr);
  // Already gone (a replay, or another device removed it): nothing to record.
  if (!pm) return { ok: true };
  if (expectedPlanId && pm.plan_id !== expectedPlanId) throw notFound("Plan move not found");
  const plan = await assertPlanOwned(supabase, pm.plan_id, coachId);

  const { data: deleted, error } = await supabase
    .from("plan_moves")
    .delete()
    .eq("id", planMoveId)
    .eq("plan_id", pm.plan_id)
    .select("id");
  if (error) dbError(error);

  await supabase.from("plans").update({ updated_at: now.toISOString() }).eq("id", pm.plan_id);

  // Only the request that actually deleted the row records the answer, so a
  // retry racing the first attempt cannot double it.
  if (reason && plan.athlete_id && (deleted ?? []).length > 0) {
    await record({
      athleteId: plan.athlete_id,
      coachId,
      userId: ctx.userId,
      planId: pm.plan_id,
      reason,
      moves: [
        {
          planMoveId,
          moveId: pm.move_id ?? null,
          name: pm.name ?? "",
          startedAt: (pm as { created_at?: string }).created_at ?? null,
        },
      ],
    });
  }
  return { ok: true };
}

export const reorderPlanMovesInput = z.object({
  orderedIds: z.array(z.string().uuid()).max(200),
});

export async function reorderPlanMoves(
  ctx: PlansContext,
  planId: string,
  orderedIds: string[],
): Promise<{ ok: true }> {
  const supabase = ctx.supabase;
  const coachId = await ensureCoachId(supabase, ctx.userId);
  await assertPlanOwned(supabase, planId, coachId);

  // Update positions one at a time (small lists; simple + safe under RLS).
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("plan_moves")
      .update({ position: i })
      .eq("id", orderedIds[i])
      .eq("plan_id", planId);
    if (error) dbError(error);
  }
  return { ok: true };
}

export const addLibraryMovesInput = z.object({
  moveIds: z.array(z.string().uuid()).min(1).max(50),
});

export async function addLibraryMovesToPlan(
  ctx: PlansContext,
  planId: string,
  moveIds: string[],
  now: Date = new Date(),
): Promise<{ inserted: number }> {
  const supabase = ctx.supabase;
  const coachId = await ensureCoachId(supabase, ctx.userId);
  await assertPlanOwned(supabase, planId, coachId);

  const { data: moves, error: mErr } = await supabase
    .from("moves")
    .select("id, name, description, cue, why, default_target_kind, default_target_value")
    .in("id", moveIds)
    .eq("coach_id", coachId);
  if (mErr) dbError(mErr);
  if (!moves?.length) return { inserted: 0 };

  const { data: last, error: posErr } = await supabase
    .from("plan_moves")
    .select("position")
    .eq("plan_id", planId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (posErr) dbError(posErr);
  let nextPos = (last?.position ?? -1) + 1;

  // Preserve the order the caller asked for
  const byId = new Map(moves.map((m) => [m.id, m]));
  const rows = moveIds
    .map((id) => byId.get(id))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => ({
      plan_id: planId,
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
  if (insErr) dbError(insErr);

  await supabase.from("plans").update({ updated_at: now.toISOString() }).eq("id", planId);

  return { inserted: rows.length };
}
