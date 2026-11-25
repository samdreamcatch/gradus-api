/**
 * Coach plans (PRD §7.3): list with filters, detail, whole-plan save,
 * per-field updates, moves inside a plan, status (with an optional bench),
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
import {
  assertPlanMediaOwned,
  assertPlanMediaVideoOwned,
  getPlanMarketplaceFields,
  marketplaceFieldsForCopy,
  planDescriptionInput,
  planLessonCountInput,
  planMediaInput,
  planMediaVideoInput,
  planPriceInput,
  planProductTypeInput,
  planSelectedLevelInput,
  planSportInput,
  planSessionsPerWeekInput,
  planWeeksInput,
  setPlanMarketplaceFields,
  type PlanMarketplaceInput,
} from "./plan-marketplace-fields.server";
import { emptySessionsByState, loadSessionsByPlanIds } from "./plan-sessions.server";
import { skillReasonSchema, type ReasonMove, type SkillReason } from "./skill-events.server";

export type PlanKind = "plan" | "template";
export type PlanStatus = "active" | "benched" | "draft";
export type TargetKind = "reps" | "mins";
/** What the athlete rates after practice: the whole plan, or each move (never both). */
export type FeedbackScope = "plan" | "moves";

type Client = SupabaseClient<Database>;

export type PlansContext = { userId: string; supabase: Client };

const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });
const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });
const forbidden = (message: string) => new ApiError({ code: "forbidden", status: 403, message });

const NOT_ON_ROSTER = "Athlete is not on your roster";

/**
 * The caller must coach this athlete. Mirrors the roster clause of the
 * "Coaches manage own plans" insert/update policies (read through the same
 * RLS client, so the two cannot disagree). One answer for "not on your
 * roster" and "no such athlete", so athlete ids cannot be probed.
 */
async function isAthleteOnRoster(supabase: Client, coachId: string, athleteId: string) {
  const { data, error } = await supabase
    .from("coach_athletes")
    .select("athlete_id")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (error) dbError(error);
  return !!data;
}

async function assertAthleteOnRoster(supabase: Client, coachId: string, athleteId: string) {
  if (!(await isAthleteOnRoster(supabase, coachId, athleteId))) throw forbidden(NOT_ON_ROSTER);
}

/**
 * The service-role client, imported lazily: this module is re-exported into the
 * client bundle, so the admin client must stay out of its static import graph
 * (see `recordCoachReason`).
 */
export type LoadAdmin = () => Promise<Client>;
const loadAdminClient: LoadAdmin = async () =>
  (await import("@/integrations/supabase/client.server")).supabaseAdmin as Client;

/**
 * A plans write the roster policy refused. Writes here are scoped to the
 * caller's own `coach_id`, so the roster clause is the only one that can fail
 * with 42501 (a non-owned row is filtered out, not refused).
 */
function planWriteError(error: { message?: string; code?: string }): never {
  if (error.code === "42501") throw forbidden(NOT_ON_ROSTER);
  dbError(error);
}

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
  /** What the athlete rates after practice: "plan" (one rating) or "moves" (each move). */
  feedbackScope: FeedbackScope;
  /** False when another coach who shares the athlete is reading it. */
  isOwner: boolean;
}

export interface AthleteOptionDTO {
  id: string;
  name: string;
  /** The roster's sport for this athlete under this coach, when one is linked. */
  sport: string | null;
}

/* ---------------- roster helpers ---------------- */

export async function listCoachAthletes(ctx: PlansContext): Promise<AthleteOptionDTO[]> {
  const coachId = await ensureCoachId(ctx.supabase, ctx.userId);
  // Every coach_athlete_sports row for this coach is a rostered athlete's (the insert trigger
  // checks the link), so both reads only need the coach and can run together.
  const [rosterRes, sportsRes] = await Promise.all([
    ctx.supabase
      .from("coach_athletes")
      .select("athlete_id, athletes!inner(id, first_name, last_name)")
      .eq("coach_id", coachId),
    ctx.supabase
      .from("coach_athlete_sports")
      .select("athlete_id, sport, created_at")
      .eq("coach_id", coachId)
      .order("created_at", { ascending: true }),
  ]);
  if (rosterRes.error) dbError(rosterRes.error);
  if (sportsRes.error) dbError(sportsRes.error);
  const data = rosterRes.data;
  // The roster's sport link: the earliest row per athlete, so the default is stable across loads.
  const sportByAthlete = new Map<string, string>();
  for (const r of sportsRes.data ?? []) {
    if (!sportByAthlete.has(r.athlete_id)) sportByAthlete.set(r.athlete_id, r.sport);
  }
  const athletes: AthleteOptionDTO[] = (data ?? []).map((row) => {
    const a = (
      row as unknown as { athletes: { id: string; first_name: string; last_name: string } }
    ).athletes;
    return {
      id: a.id,
      name: `${a.first_name} ${a.last_name}`.trim(),
      sport: sportByAthlete.get(a.id) ?? null,
    };
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
    .select(
      "id, title, notes, kind, status, athlete_id, updated_at, voice_transcript, coach_id, feedback_scope",
    )
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
    feedbackScope: plan.feedback_scope === "moves" ? "moves" : "plan",
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

/** Marketplace fields beside price and media; each absent one stays as it is. */
const marketplaceDetailInputs = {
  /** "plan" or "program". */
  productType: planProductTypeInput.optional(),
  /** The sport the plan is for (a sport key, "figure_skating"); filters the marketplace. */
  sport: planSportInput.optional(),
  /** The level the plan is for, as the frontend sends it. */
  selectedLevel: planSelectedLevelInput.optional(),
  /** The other end of a level range; null (or absent with `selectedLevel`) is a single level. */
  selectedLevelTo: planSelectedLevelInput.nullable().optional(),
  /** Marketplace description; null clears it. */
  description: planDescriptionInput.nullable().optional(),
  /** Weeks the plan runs (1-52); null clears it. */
  weeks: planWeeksInput.nullable().optional(),
  /** Practice sessions per week (1-14); null clears it. */
  sessionsPerWeek: planSessionsPerWeekInput.nullable().optional(),
  /** Lessons in a Program (1-100); null clears it. */
  lessonCount: planLessonCountInput.nullable().optional(),
};

export const savePlanInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(160),
  notes: z.string().max(4000).default(""),
  kind: z.enum(["plan", "template"]),
  athleteId: z.string().uuid().nullable().optional(),
  moves: z.array(savePlanMoveInput).max(200),
  /** Marketplace price in USD (0 is free); absent leaves it as it is. */
  price: planPriceInput.optional(),
  /** The plan's image (see plan-marketplace-fields.server.ts); null removes it. */
  media: planMediaInput.nullable().optional(),
  mediaVideo: planMediaVideoInput.nullable().optional(),
  ...marketplaceDetailInputs,
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
  if (data.media) await assertPlanMediaOwned(supabase, coachId, data.media);
  if (data.mediaVideo) await assertPlanMediaVideoOwned(supabase, coachId, data.mediaVideo);

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
    if (planRow.athlete_id) await assertAthleteOnRoster(supabase, coachId, planRow.athlete_id);
    const { error } = await supabase
      .from("plans")
      .update(planRow)
      .eq("id", planId)
      .eq("coach_id", coachId);
    if (error) planWriteError(error);
  } else {
    if (planRow.athlete_id) await assertAthleteOnRoster(supabase, coachId, planRow.athlete_id);
    const { data: inserted, error } = await supabase
      .from("plans")
      .insert({ ...planRow, status: "benched" })
      .select("id")
      .single();
    if (error) planWriteError(error);
    planId = inserted.id;
  }
  await setPlanMarketplaceFields(supabase, planId!, data);

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
  /**
   * Optional on an activate: bench this other active plan of the athlete in
   * the same step. Older iOS builds send it after their "replace" prompt;
   * there is no cap on active plans (PRD decision #52), so nothing requires it.
   */
  replaceId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Optional, activate only: bench this plan (another of the athlete's active plans from this coach) in the same step. If it is not one of them (already benched, this plan, another athlete's), nothing is benched and the activation still goes through. There is no cap on active plans per athlete, so activation never requires it.",
    ),
  /**
   * The coach's answer to the "why" prompt (PRD §7.3, decision #17). On a
   * bench it covers this plan; on an activate with `replaceId` it covers the
   * plan benched in the same step. Ignored otherwise.
   */
  reason: skillReasonSchema
    .optional()
    .describe(
      'The coach\'s "why" answer. On a bench it covers this plan; on an activate with replaceId it covers the plan benched in the same step. Ignored otherwise.',
    ),
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
 * There is no cap on active plans per athlete (PRD decision #52): activation
 * always goes through. An optional `replaceId` benches one of the athlete's
 * other active plans in the same step, which older iOS builds still send
 * after their "replace" prompt; when it names anything else (a plan already
 * benched, this plan, another athlete's), nothing is benched and the
 * activation still goes through.
 */
export const COACH_PRO_REQUIRED_TO_PUBLISH =
  "Publishing to the marketplace needs Coach Pro. Your plan is saved as a draft: upgrade to Coach Pro to publish it.";

/** Refuses unless the coach's effective tier is Coach Pro (`coach_effective_tier`). */
async function assertCoachProForPublish(supabase: PlansContext["supabase"], coachId: string) {
  const { data: tier, error } = await supabase.rpc("coach_effective_tier", { _coach_id: coachId });
  if (error) dbError(error);
  if (tier !== "coach_pro") {
    throw new ApiError({
      code: "coach_pro_required",
      status: 403,
      message: COACH_PRO_REQUIRED_TO_PUBLISH,
    });
  }
}

export async function setPlanStatus(
  ctx: PlansContext,
  id: string,
  data: z.infer<typeof setPlanStatusInput>,
  record: RecordCoachReason = recordCoachReason,
  loadAdmin: LoadAdmin = loadAdminClient,
): Promise<{ ok: true }> {
  const supabase = ctx.supabase;
  const coachId = await ensureCoachId(supabase, ctx.userId);

  if (data.status === "active") {
    const { data: owned, error: ownErr } = await supabase
      .from("plans")
      .select("id, athlete_id, title, status, kind")
      .eq("id", id)
      .eq("coach_id", coachId)
      .maybeSingle();
    if (ownErr) dbError(ownErr);
    if (!owned) throw notFound("Plan not found");

    // A plan with no athlete goes live as a marketplace listing: Coach Pro only. A basic
    // coach can draft one (scope: "can still draft a plan so the upgrade has a clear
    // payoff") but not publish it. Activating a plan for a rostered athlete is unchanged.
    if (!owned.athlete_id && (owned.kind ?? "plan") === "plan" && owned.status !== "active") {
      await assertCoachProForPublish(supabase, coachId);
    }

    // Athlete-scoped conflict logic only runs when an athlete is assigned.
    // A plan with no athlete is a public/social share and activates directly.
    if (owned.athlete_id) {
      // Going live reaches the athlete's household (email and push below), so a
      // plan whose athlete is not on the roster is refused up front.
      await assertAthleteOnRoster(supabase, coachId, owned.athlete_id);

      if (data.replaceId && data.replaceId !== id) {
        // The replaced plan is benched, so the coach's "why" answer belongs
        // to it, not to the plan being activated. The conditional update
        // only touches another of this athlete's active plans from this
        // coach, and keeps the answer atomic with the transition (same rule
        // as a plain bench below). A replay, or a plan benched since the
        // prompt opened, changes no row and records nothing, and the
        // activation still goes through: with no cap there is nothing to
        // refuse, and an outbox replay after a lost response must not park a
        // finished activation as a conflict.
        const { data: benched, error: bErr } = await supabase
          .from("plans")
          .update({ status: "benched" })
          .eq("id", data.replaceId)
          .eq("coach_id", coachId)
          .eq("athlete_id", owned.athlete_id)
          .eq("kind", "plan")
          .eq("status", "active")
          .select("id, athlete_id");
        if (bErr) planWriteError(bErr);
        const replaced = (benched ?? [])[0] as
          | { id: string; athlete_id: string | null }
          | undefined;
        if (data.reason && replaced?.athlete_id) {
          await record({
            athleteId: replaced.athlete_id,
            coachId,
            userId: ctx.userId,
            planId: replaced.id,
            reason: data.reason,
          });
        }
      }
    }

    const { error } = await supabase
      .from("plans")
      .update({ status: "active" })
      .eq("id", id)
      .eq("coach_id", coachId);
    if (error) planWriteError(error);

    // Guardian-on-file: the existing "Guardian message copy" email carries
    // the assignment to a parent or guardian who hasn't joined yet, only on
    // the transition into active. Since decision #56 a coach cannot message
    // such an athlete, so this is what tells the parent a plan was shared.
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
      // Dynamic imports: this module reaches the client bundle (plans.functions.ts
      // imports its input schemas), so the push stack must not join its static
      // import graph — same reason `guardian.server` is imported lazily above.
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
          athleteId,
        });
      });
    }
  } else {
    // A plan whose athlete has left the roster can no longer be edited or put
    // live (the roster policy refuses those writes), but its coach may still
    // take it down: active to benched or draft, nothing else. That one write
    // goes through the server, after the ownership and shape checks here, and
    // records no "why" (the coach no longer coaches the athlete).
    const { data: current, error: curErr } = await supabase
      .from("plans")
      .select("id, athlete_id, status")
      .eq("id", id)
      .eq("coach_id", coachId)
      .maybeSingle();
    if (curErr) dbError(curErr);
    if (current?.athlete_id && !(await isAthleteOnRoster(supabase, coachId, current.athlete_id))) {
      if (current.status === data.status) return { ok: true }; // a replay: nothing to change
      if (current.status !== "active") throw forbidden(NOT_ON_ROSTER);
      const admin = await loadAdmin();
      const { error: demoteErr } = await admin
        .from("plans")
        .update({ status: data.status })
        .eq("id", id)
        .eq("coach_id", coachId)
        .eq("status", "active");
      if (demoteErr) dbError(demoteErr);
      return { ok: true };
    }

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
      if (error) planWriteError(error);
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
      if (error) planWriteError(error);
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
  /** Marketplace price in USD (0 is free); a copy keeps its source's price unless this is sent. */
  price: planPriceInput.optional(),
  /** The plan's image (see plan-marketplace-fields.server.ts); a copy never takes its source's. */
  media: planMediaInput.nullable().optional(),
  mediaVideo: planMediaVideoInput.nullable().optional(),
  ...marketplaceDetailInputs,
});

/**
 * `POST /api/v1/coach/plans`: product type and price are optional, so app
 * builds that don't send them (the App Store app before the marketplace) keep
 * creating plans. A new plan without a product type is a "plan"; without a
 * price it's free (the column default). A copy (`fromPlanId` /
 * `fromTemplateId`) takes its source's unless sent. The level is optional: the
 * app creates the draft before the coach picks one and sets it with
 * `PATCH /api/v1/plans/{id}`. The web app's server function still takes
 * `createPlanInput`.
 */
export const createPlanApiInput = createPlanInput.transform((input) =>
  input.fromPlanId || input.fromTemplateId || input.productType !== undefined
    ? input
    : { ...input, productType: "plan" as const },
);

/** A new draft (or benched template), optionally cloned from one of the coach's plans or templates. */
export async function createPlan(
  ctx: PlansContext,
  data: z.infer<typeof createPlanInput>,
): Promise<{ id: string }> {
  const supabase = ctx.supabase;
  const coachId = await ensureCoachId(supabase, ctx.userId);
  if (data.kind === "plan" && data.athleteId) {
    await assertAthleteOnRoster(supabase, coachId, data.athleteId);
  }
  if (data.media) await assertPlanMediaOwned(supabase, coachId, data.media);
  if (data.mediaVideo) await assertPlanMediaVideoOwned(supabase, coachId, data.mediaVideo);

  const sourceId = data.fromPlanId ?? data.fromTemplateId;
  let marketplace: PlanMarketplaceInput = data;
  let title = data.title ?? "Untitled plan";
  let notes = "";
  let feedbackScope: FeedbackScope = "plan";
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
      .select("title, notes, feedback_scope")
      .eq("id", sourceId)
      .eq("coach_id", coachId)
      .maybeSingle();
    if (error) dbError(error);
    if (!src) throw notFound("Plan not found");
    title = data.title ?? (src.title ? `${src.title} (copy)` : title);
    notes = src.notes;
    // A copy asks for the same feedback as the plan or template it came from.
    if (src.feedback_scope === "moves") feedbackScope = "moves";
    marketplace = marketplaceFieldsForCopy(
      await getPlanMarketplaceFields(supabase, sourceId),
      data,
    );
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
      feedback_scope: feedbackScope,
    })
    .select("id")
    .single();
  if (insErr) planWriteError(insErr);
  await setPlanMarketplaceFields(supabase, inserted.id, marketplace);

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
  feedbackScope: z.enum(["plan", "moves"]).optional(),
  /** Marketplace price in USD (0 is free). */
  price: planPriceInput.optional(),
  /** The plan's image (see plan-marketplace-fields.server.ts); null removes it. */
  media: planMediaInput.nullable().optional(),
  mediaVideo: planMediaVideoInput.nullable().optional(),
  ...marketplaceDetailInputs,
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
  if (data.media) await assertPlanMediaOwned(supabase, coachId, data.media);
  if (data.mediaVideo) await assertPlanMediaVideoOwned(supabase, coachId, data.mediaVideo);

  // Load current row so we can keep the kind/status/athlete combination
  // valid per the plans_kind_athlete_chk constraint.
  const { data: current, error: loadErr } = await supabase
    .from("plans")
    .select("kind,status,athlete_id,title,notes,feedback_scope")
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
    if (data.athleteId) await assertAthleteOnRoster(supabase, coachId, data.athleteId);
    const nextTitle = data.title ?? current.title ?? "Untitled plan";
    const nextNotes = data.notes ?? current.notes ?? "";
    const marketplace = marketplaceFieldsForCopy(
      await getPlanMarketplaceFields(supabase, id),
      data,
    );
    const { data: inserted, error: insErr } = await supabase
      .from("plans")
      .insert({
        coach_id: coachId,
        title: nextTitle,
        notes: nextNotes,
        kind: "plan",
        athlete_id: data.athleteId ?? null,
        status: "draft",
        feedback_scope: data.feedbackScope ?? current.feedback_scope,
      })
      .select("id")
      .single();
    if (insErr) planWriteError(insErr);
    await setPlanMarketplaceFields(supabase, inserted.id, marketplace);

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
    feedback_scope?: FeedbackScope;
  } = { updated_at: now.toISOString() };
  if (data.title !== undefined) patch.title = data.title;
  if (data.feedbackScope !== undefined) patch.feedback_scope = data.feedbackScope;
  if (data.notes !== undefined) patch.notes = data.notes;
  if (data.kind !== undefined) {
    patch.kind = data.kind;
    if (data.kind === "template") patch.athlete_id = null;
  }
  if (data.athleteId !== undefined) patch.athlete_id = data.athleteId;

  // Resolve the post-patch shape and reconcile against the constraint. Only a
  // change of kind or athlete reshapes the plan: editing a published
  // marketplace plan (active, no athlete) must not take it off sale.
  const nextKind = patch.kind ?? current.kind;
  const nextAthlete = patch.athlete_id !== undefined ? patch.athlete_id : current.athlete_id;
  const nextStatus = current.status;
  const reshaped = data.kind !== undefined || data.athleteId !== undefined;

  if (!reshaped) {
    // Title, notes, feedback scope, marketplace fields: the status stays.
  } else if (nextKind === "template") {
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

  // The row that results must still be one the coach may hold: the athlete, if
  // any, is on the roster (the database refuses the write otherwise).
  const resultingAthlete = patch.athlete_id !== undefined ? patch.athlete_id : current.athlete_id;
  if (resultingAthlete) await assertAthleteOnRoster(supabase, coachId, resultingAthlete);

  const { error } = await supabase.from("plans").update(patch).eq("id", id).eq("coach_id", coachId);
  if (error) planWriteError(error);
  await setPlanMarketplaceFields(supabase, id, data);

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

  // A move goes into a plan once: refuse one that's already there.
  const { data: present, error: presentErr } = await supabase
    .from("plan_moves")
    .select("move_id")
    .eq("plan_id", planId)
    .in("move_id", moveIds);
  if (presentErr) dbError(presentErr);
  const presentIds = new Set((present ?? []).map((r) => r.move_id));
  const repeated = moves.find((m) => presentIds.has(m.id));
  if (repeated) {
    throw new ApiError({
      code: "move_already_in_plan",
      status: 409,
      message: `${repeated.name} is already in this plan.`,
    });
  }

  const { data: last, error: posErr } = await supabase
    .from("plan_moves")
    .select("position")
    .eq("plan_id", planId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (posErr) dbError(posErr);
  let nextPos = (last?.position ?? -1) + 1;

  // Preserve the order the caller asked for; a move sent twice goes in once.
  const byId = new Map(moves.map((m) => [m.id, m]));
  const rows = Array.from(new Set(moveIds))
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
