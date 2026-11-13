/**
 * Athlete-authored plans (PRD §6.14, decision #35): an athlete, minor or
 * adult, creates, edits, activates, benches and deletes their own plans with
 * the same editor and the seeded move curriculum a coach has, and can never
 * assign a plan to anyone. Single source of truth for the `/api/v1/athlete/
 * plans*`, `/api/v1/athlete/moves` and `/api/v1/athlete/voice/build-plan`
 * routes.
 *
 * A parallel module, never a generalization: `plans.server.ts`,
 * `moves.server.ts` and `voice.server.ts` keep their coach-keyed filters (the
 * §4.1 no-disruption posture). Every read and write here goes through the
 * caller's RLS client AND names its own ownership explicitly (`athlete_id` =
 * the caller's athlete, `source = 'athlete'`), so a policy mistake cannot
 * widen it. A self-authored plan is `kind = 'plan'`, `source = 'athlete'`,
 * `coach_id NULL` (migration `20261006010000_athlete_authored_plans.sql`).
 *
 * There is no cap on an athlete's own active plans (§12 #33), no "why"
 * prompt, and no assignment: those are coach-pairing rules.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import type { MoveDTO, MoveLibraryDTO, TargetKind } from "./moves.server";
import { getPlanSessionCounts } from "./plan-sessions.server";
import type { RoleAwarePlanDetailDTO } from "./plan-detail.server";

type Client = SupabaseClient<Database>;

export type AuthoringContext = { userId: string; supabase: Client };
export type AuthoringDetailContext = AuthoringContext & { admin: Client };

/** The `plans.source` value that marks a plan the athlete wrote. */
export const ATHLETE_SOURCE = "athlete";

export const PAUSED_MESSAGE =
  "This athlete's account is paused because consent was withdrawn through Apple. Email support@gradussports.com to restore it.";

const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });

export interface AuthorAthlete {
  id: string;
  firstName: string;
}

/**
 * The caller's athlete row. Refuses anyone who is not an athlete (403
 * `wrong_role`) and, unless `allowPaused`, a paused athlete (403 `paused`):
 * a paused account keeps what it has but writes nothing new. Reads (the
 * library) pass `allowPaused`.
 */
export async function requireAuthor(
  supabase: Client,
  userId: string,
  opts: { allowPaused?: boolean } = {},
): Promise<AuthorAthlete> {
  const { data, error } = await supabase
    .from("athletes")
    .select("id, first_name, account_state")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) {
    throw new ApiError({
      code: "wrong_role",
      status: 403,
      message: "Only athletes can write their own plans.",
    });
  }
  if (!opts.allowPaused && (data.account_state ?? "active") === "paused") {
    throw new ApiError({ code: "paused", status: 403, message: PAUSED_MESSAGE });
  }
  return { id: data.id, firstName: data.first_name };
}

/**
 * Is this athlete paused (Apple withdrew parental consent, §6.13)? Judged per
 * USER, like the database's `is_athlete_paused`: an existing policy lets a
 * signed-in user open a second athletes row, and the pause must not be escaped
 * with it. For callers that write with the admin client, where RLS cannot say no.
 */
export async function isAthletePaused(client: Client, athleteId: string): Promise<boolean> {
  const row = await client
    .from("athletes")
    .select("user_id, account_state")
    .eq("id", athleteId)
    .maybeSingle();
  if (row.error) dbError(row.error);
  if (!row.data) return false;
  if (row.data.account_state === "paused") return true;
  if (!row.data.user_id) return false;
  const others = await client
    .from("athletes")
    .select("id")
    .eq("user_id", row.data.user_id)
    .eq("account_state", "paused");
  if (others.error) dbError(others.error);
  return (others.data ?? []).length > 0;
}

/** A plan the athlete wrote, or 404: another athlete's, a coach's or a Gradus plan never resolves here. */
export async function loadOwnedPlan(supabase: Client, athleteId: string, planId: string) {
  const { data, error } = await supabase
    .from("plans")
    .select("id, title, notes, status")
    .eq("id", planId)
    .eq("athlete_id", athleteId)
    .eq("source", ATHLETE_SOURCE)
    .eq("kind", "plan")
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw notFound("Plan not found");
  return data;
}

async function touchPlan(supabase: Client, athleteId: string, planId: string, now: Date) {
  await supabase
    .from("plans")
    .update({ updated_at: now.toISOString() })
    .eq("id", planId)
    .eq("athlete_id", athleteId)
    .eq("source", ATHLETE_SOURCE);
}

/* ---------------- create ---------------- */

export const createAthletePlanInput = z.object({
  /** Copy one of the athlete's own plans into a new draft. */
  fromPlanId: z.string().uuid().optional(),
  title: z.string().min(1).max(160).optional(),
});

/** A new draft, optionally a copy of one of the athlete's own plans. */
export async function createAthletePlan(
  ctx: AuthoringContext,
  data: z.infer<typeof createAthletePlanInput>,
): Promise<{ id: string }> {
  const { supabase } = ctx;
  const athlete = await requireAuthor(supabase, ctx.userId);

  let title = data.title ?? "Untitled plan";
  let notes = "";
  let sourceMoves: Array<{
    position: number;
    name: string;
    description: string;
    cue: string;
    why: string;
    target_kind: string;
    target_value: number;
  }> = [];

  if (data.fromPlanId) {
    const src = await loadOwnedPlan(supabase, athlete.id, data.fromPlanId);
    title = data.title ?? (src.title ? `${src.title} (copy)`.slice(0, 160) : title);
    notes = src.notes;
    const { data: moves, error } = await supabase
      .from("plan_moves")
      .select("position, name, description, cue, why, target_kind, target_value")
      .eq("plan_id", src.id)
      .order("position", { ascending: true });
    if (error) dbError(error);
    sourceMoves = moves ?? [];
  }

  const { data: inserted, error: insErr } = await supabase
    .from("plans")
    .insert({
      athlete_id: athlete.id,
      kind: "plan",
      source: ATHLETE_SOURCE,
      status: "draft",
      title,
      notes,
    })
    .select("id")
    .single();
  if (insErr) dbError(insErr);

  if (sourceMoves.length) {
    const rows = sourceMoves.map((m, i) => ({
      plan_id: inserted.id,
      position: i,
      move_id: null,
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

/* ---------------- update / status / delete ---------------- */

export const updateAthletePlanPatch = z.object({
  title: z.string().max(160).optional(),
  notes: z.string().max(4000).optional(),
});

export async function updateAthletePlan(
  ctx: AuthoringContext,
  planId: string,
  patch: z.infer<typeof updateAthletePlanPatch>,
  now: Date = new Date(),
): Promise<{ ok: true }> {
  const { supabase } = ctx;
  const athlete = await requireAuthor(supabase, ctx.userId);
  await loadOwnedPlan(supabase, athlete.id, planId);

  const row: { updated_at: string; title?: string; notes?: string } = {
    updated_at: now.toISOString(),
  };
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.notes !== undefined) row.notes = patch.notes;

  const { error } = await supabase
    .from("plans")
    .update(row)
    .eq("id", planId)
    .eq("athlete_id", athlete.id)
    .eq("source", ATHLETE_SOURCE);
  if (error) dbError(error);
  return { ok: true };
}

export const setAthletePlanStatusInput = z.object({
  status: z.enum(["active", "benched", "draft"]),
});

/** No cap, no conflict, no "why": an athlete's own plans are theirs to activate and bench. Idempotent. */
export async function setAthletePlanStatus(
  ctx: AuthoringContext,
  planId: string,
  data: z.infer<typeof setAthletePlanStatusInput>,
  now: Date = new Date(),
): Promise<{ ok: true }> {
  const { supabase } = ctx;
  const athlete = await requireAuthor(supabase, ctx.userId);
  await loadOwnedPlan(supabase, athlete.id, planId);

  const { error } = await supabase
    .from("plans")
    .update({ status: data.status, updated_at: now.toISOString() })
    .eq("id", planId)
    .eq("athlete_id", athlete.id)
    .eq("source", ATHLETE_SOURCE);
  if (error) dbError(error);
  return { ok: true };
}

/** Drafts and benched plans may be deleted; an active plan is benched first, as for coaches. */
export async function deleteAthletePlan(
  ctx: AuthoringContext,
  planId: string,
): Promise<{ ok: true }> {
  const { supabase } = ctx;
  const athlete = await requireAuthor(supabase, ctx.userId);
  const plan = await loadOwnedPlan(supabase, athlete.id, planId);
  if (plan.status === "active") {
    throw new ApiError({
      code: "not_deletable",
      status: 422,
      message:
        "This plan is active. Delete it first; it then waits in Recently deleted, where Delete now removes it for good.",
    });
  }

  const { error: mErr } = await supabase.from("plan_moves").delete().eq("plan_id", planId);
  if (mErr) dbError(mErr);
  const { error } = await supabase
    .from("plans")
    .delete()
    .eq("id", planId)
    .eq("athlete_id", athlete.id)
    .eq("source", ATHLETE_SOURCE);
  if (error) dbError(error);
  return { ok: true };
}

/* ---------------- moves inside a plan ---------------- */

export const addAthleteLibraryMovesInput = z.object({
  moveIds: z.array(z.string().uuid()).min(1).max(50),
});

/** The sports on the athlete's goals: what the read-only curriculum is filtered by. */
async function athleteSports(supabase: Client, athleteId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("athlete_goals")
    .select("sport")
    .eq("athlete_id", athleteId);
  if (error) dbError(error);
  return Array.from(new Set((data ?? []).map((g) => g.sport)));
}

const SEED_COLUMNS =
  "id, sport, category, name, description, cue, why, default_target_kind, default_target_value";

function seedToDTO(row: {
  id: string;
  sport: string;
  category: string;
  name: string;
  description: string;
  cue: string;
  why: string;
  default_target_kind: string;
  default_target_value: number;
}): MoveDTO {
  return {
    id: row.id,
    sport: row.sport,
    category: row.category,
    name: row.name,
    description: row.description,
    cue: row.cue,
    why: row.why,
    defaultTargetKind: row.default_target_kind as TargetKind,
    defaultTargetValue: Number(row.default_target_value),
  };
}

/**
 * Append curriculum moves, in the order given. They copy into the plan as
 * plain rows (no `move_id`): an athlete has no personal library, so there is
 * nothing to link to. Ids outside the athlete's sports are ignored, the same
 * set `listAthleteMoves` offers.
 */
export async function addSeedMovesToAuthoredPlan(
  ctx: AuthoringContext,
  planId: string,
  moveIds: string[],
  now: Date = new Date(),
): Promise<{ inserted: number }> {
  const { supabase } = ctx;
  const athlete = await requireAuthor(supabase, ctx.userId);
  await loadOwnedPlan(supabase, athlete.id, planId);

  const sports = await athleteSports(supabase, athlete.id);
  if (!sports.length) return { inserted: 0 };

  const { data: seeds, error: sErr } = await supabase
    .from("seed_moves")
    .select(SEED_COLUMNS)
    .in("id", moveIds)
    .in("sport", sports);
  if (sErr) dbError(sErr);
  if (!seeds?.length) return { inserted: 0 };

  const { data: last, error: posErr } = await supabase
    .from("plan_moves")
    .select("position")
    .eq("plan_id", planId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (posErr) dbError(posErr);
  let nextPos = (last?.position ?? -1) + 1;

  const byId = new Map(seeds.map((m) => [m.id, m]));
  const rows = moveIds
    .map((id) => byId.get(id))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => ({
      plan_id: planId,
      move_id: null,
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

  await touchPlan(supabase, athlete.id, planId, now);
  return { inserted: rows.length };
}

export const athleteMovePatch = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  cue: z.string().max(1000).optional(),
  why: z.string().max(1000).optional(),
  targetKind: z.enum(["reps", "mins"]).optional(),
  targetValue: z.number().min(0).max(10000).optional(),
});

/** The move must belong to the plan in the path, and the plan to the athlete. */
export async function updateAuthoredPlanMove(
  ctx: AuthoringContext,
  planId: string,
  planMoveId: string,
  patch: z.infer<typeof athleteMovePatch>,
  now: Date = new Date(),
): Promise<{ ok: true }> {
  const { supabase } = ctx;
  const athlete = await requireAuthor(supabase, ctx.userId);
  await loadOwnedPlan(supabase, athlete.id, planId);

  const { data: pm, error: pmErr } = await supabase
    .from("plan_moves")
    .select("id")
    .eq("id", planMoveId)
    .eq("plan_id", planId)
    .maybeSingle();
  if (pmErr) dbError(pmErr);
  if (!pm) throw notFound("Plan move not found");

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

  if (Object.keys(row).length) {
    const { error } = await supabase
      .from("plan_moves")
      .update(row)
      .eq("id", planMoveId)
      .eq("plan_id", planId);
    if (error) dbError(error);
  }
  await touchPlan(supabase, athlete.id, planId, now);
  return { ok: true };
}

/** Removing a move that is already gone (a replayed request) is a success. */
export async function removeAuthoredPlanMove(
  ctx: AuthoringContext,
  planId: string,
  planMoveId: string,
  now: Date = new Date(),
): Promise<{ ok: true }> {
  const { supabase } = ctx;
  const athlete = await requireAuthor(supabase, ctx.userId);
  await loadOwnedPlan(supabase, athlete.id, planId);

  const { error } = await supabase
    .from("plan_moves")
    .delete()
    .eq("id", planMoveId)
    .eq("plan_id", planId);
  if (error) dbError(error);
  await touchPlan(supabase, athlete.id, planId, now);
  return { ok: true };
}

export const reorderAthleteMovesInput = z.object({
  orderedIds: z.array(z.string().uuid()).max(200),
});

export async function reorderAuthoredPlanMoves(
  ctx: AuthoringContext,
  planId: string,
  orderedIds: string[],
  now: Date = new Date(),
): Promise<{ ok: true }> {
  const { supabase } = ctx;
  const athlete = await requireAuthor(supabase, ctx.userId);
  await loadOwnedPlan(supabase, athlete.id, planId);

  // One at a time, as the coach twin does: small lists, simple and safe under RLS.
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("plan_moves")
      .update({ position: i })
      .eq("id", orderedIds[i])
      .eq("plan_id", planId);
    if (error) dbError(error);
  }
  await touchPlan(supabase, athlete.id, planId, now);
  return { ok: true };
}

/* ---------------- the read-only curriculum ---------------- */

/**
 * The seeded curriculum for the sports on the athlete's goals (PRD §6.14 C):
 * read-only, no personal library. Same shape as the coach's library so one
 * client component serves both. A paused athlete may still read it.
 */
export async function listAthleteMoves(ctx: AuthoringContext): Promise<MoveLibraryDTO> {
  const { supabase } = ctx;
  const athlete = await requireAuthor(supabase, ctx.userId, { allowPaused: true });
  const sports = await athleteSports(supabase, athlete.id);
  if (!sports.length) return { moves: [], seedCategories: [] };

  const { data, error } = await supabase
    .from("seed_moves")
    .select(SEED_COLUMNS)
    .in("sport", sports)
    .order("category", { ascending: true })
    .order("name", { ascending: true });
  if (error) dbError(error);

  const moves = (data ?? []).map(seedToDTO);
  const seen = new Set<string>();
  const seedCategories: { sport: string; category: string }[] = [];
  for (const m of moves) {
    const key = `${m.sport}\u0000${m.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    seedCategories.push({ sport: m.sport, category: m.category });
  }
  return { moves, seedCategories };
}

/* ---------------- detail (the author's view) ---------------- */

/**
 * The author's own view of a plan they wrote, in any status (a voice-built
 * draft included), or null when `planId` is not one of theirs. This is what
 * `GET /plans/{id}` serves the author: `isOwner: true`, the transcript they
 * dictated, no coach. Ownership is verified through RLS first; the moves are
 * then read with the admin client, as the athlete runner does, so the
 * per-row policy join cannot time out.
 */
export async function getAuthoredPlanDetail(
  ctx: AuthoringDetailContext,
  planId: string,
): Promise<RoleAwarePlanDetailDTO | null> {
  const { supabase, admin } = ctx;
  const { data: athlete, error: aErr } = await supabase
    .from("athletes")
    .select("id, first_name")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (aErr) dbError(aErr);
  if (!athlete) return null;

  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, title, notes, status, updated_at, voice_transcript, athlete_id")
    .eq("id", planId)
    .eq("athlete_id", athlete.id)
    .eq("source", ATHLETE_SOURCE)
    .eq("kind", "plan")
    .maybeSingle();
  if (error) dbError(error);
  if (!plan) return null;

  const { data: moves, error: mErr } = await admin
    .from("plan_moves")
    .select("id, position, name, description, cue, why, target_kind, target_value")
    .eq("plan_id", plan.id)
    .order("position", { ascending: true });
  if (mErr) dbError(mErr);

  const planMoves = (moves ?? []).map((m) => ({
    id: m.id,
    position: m.position,
    moveId: null,
    name: m.name,
    description: m.description,
    cue: m.cue,
    why: m.why,
    targetKind: m.target_kind as TargetKind,
    targetValue: Number(m.target_value),
    libraryMove: null,
  }));
  const totalMinutes = planMoves
    .filter((m) => m.targetKind === "mins")
    .reduce((s, m) => s + m.targetValue, 0);
  const sessions = await getPlanSessionCounts(admin, plan.id);

  return {
    id: plan.id,
    title: plan.title,
    notes: plan.notes,
    kind: "plan",
    status: plan.status as "active" | "benched" | "draft",
    athleteId: plan.athlete_id,
    athleteName: null,
    athleteFirstName: athlete.first_name,
    coach: null,
    viewerRole: "athlete",
    isOwner: true,
    moveCount: planMoves.length,
    totalMinutes,
    updatedAt: plan.updated_at,
    moves: planMoves,
    voiceTranscript: plan.voice_transcript ?? null,
    sessionsByState: sessions.sessionsByState,
    sessionsTotal: sessions.sessionsTotal,
    source: ATHLETE_SOURCE,
    authorFirstName: athlete.first_name,
  };
}
