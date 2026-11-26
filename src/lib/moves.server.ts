/**
 * The coach's move library (PRD §7.3 "Move library"): list with the seeded
 * curriculum categories, upsert with name-conflict detection, archive, and
 * the three ways a plan move flows into the library (save, update, fork).
 * Single source of truth for moves.functions.ts and `/api/v1/coach/moves`.
 * Reads and writes go through the caller's RLS client, as on the web.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";

export type TargetKind = "reps" | "mins";

export interface MoveDTO {
  id: string;
  sport: string;
  category: string;
  name: string;
  description: string;
  cue: string;
  why: string;
  defaultTargetKind: TargetKind;
  defaultTargetValue: number;
}

export interface NameConflict {
  existingMoveId: string;
  name: string;
}

export interface MoveLibraryDTO {
  moves: MoveDTO[];
  seedCategories: { sport: string; category: string }[];
}

export type UpsertMoveResult = { ok: true; move: MoveDTO } | { ok: false; conflict: NameConflict };
export type LibraryLinkResult =
  | { ok: true; moveId: string }
  | { ok: false; conflict: NameConflict };

type Client = SupabaseClient<Database>;

export type MovesContext = {
  userId: string;
  supabase: Client;
  /**
   * The caller's `coach_profiles.id`, when the route has already read it for
   * this `userId` (`requirePlansCoach`): the functions here then skip reading
   * it again. Never taken from a request.
   */
  coachId?: string;
};

const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });
const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });

async function requireCoachId(ctx: MovesContext): Promise<string> {
  const coachId = await findCoachId(ctx);
  if (!coachId) throw unprocessable("Coach profile not found");
  return coachId;
}

async function findCoachId(ctx: MovesContext): Promise<string | null> {
  if (ctx.coachId !== undefined) return ctx.coachId;
  const { data, error } = await ctx.supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) dbError(error);
  return data?.id ?? null;
}

function toDTO(row: {
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

const MOVE_COLUMNS =
  "id, sport, category, name, description, cue, why, default_target_kind, default_target_value";

/** The library, seeding the curriculum for the coach's sports on every read (idempotent). */
export async function listMoves(ctx: MovesContext): Promise<MoveLibraryDTO> {
  const supabase = ctx.supabase;
  const coachId = await findCoachId(ctx);
  if (!coachId) {
    // Non-coach user (or coach onboarding not complete) — degrade gracefully
    // instead of blank-screening the route.
    return { moves: [], seedCategories: [] };
  }

  // Idempotent seed — also picks up sports added after the first visit.
  const seedRes = await supabase.rpc("seed_coach_library", { _coach_id: coachId });
  if (seedRes.error) {
    console.error("seed_coach_library failed", {
      coachId,
      message: seedRes.error.message,
      details: seedRes.error.details,
    });
  }

  // Club coaches: bring the club's move and level edits in (club version wins).
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncCoachClubContent } = await import("./org-content.server");
    await syncCoachClubContent(supabaseAdmin, coachId);
  } catch (err) {
    console.error("[moves] club sync failed", err);
  }

  const { data, error } = await supabase
    .from("moves")
    .select(MOVE_COLUMNS)
    .eq("coach_id", coachId)
    .is("archived_at", null)
    .order("category", { ascending: true })
    .order("name", { ascending: true });
  if (error) dbError(error);

  // Curriculum categories from seed_moves (all sports — small table)
  const { data: seeds } = await supabase.from("seed_moves").select("sport, category");

  return {
    moves: (data ?? []).map(toDTO),
    seedCategories: seeds ?? [],
  };
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase();
}

async function findNameConflict(
  supabase: Client,
  coachId: string,
  name: string,
  excludeMoveId?: string,
): Promise<NameConflict | null> {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  const { data, error } = await supabase
    .from("moves")
    .select("id, name")
    .eq("coach_id", coachId)
    .is("archived_at", null);
  if (error) dbError(error);
  const hit = (data ?? []).find(
    (r) => normalizeName(r.name as string) === normalized && r.id !== excludeMoveId,
  );
  return hit ? { existingMoveId: hit.id as string, name: hit.name as string } : null;
}

export const moveInput = z.object({
  id: z.string().uuid().optional(),
  sport: z.string().min(1).max(64),
  category: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  cue: z.string().max(1000).default(""),
  why: z.string().max(1000).default(""),
  defaultTargetKind: z.enum(["reps", "mins"]),
  defaultTargetValue: z.number().min(0).max(10000),
  overwriteMoveId: z.string().uuid().optional(),
});

/** Create or update a move; a same-named live move answers `{ ok: false, conflict }` unless `overwriteMoveId` targets it. */
export async function upsertMove(
  ctx: MovesContext,
  data: z.infer<typeof moveInput>,
): Promise<UpsertMoveResult> {
  const supabase = ctx.supabase;
  const coachId = await requireCoachId(ctx);

  const row = {
    coach_id: coachId,
    sport: data.sport,
    category: data.category,
    name: data.name,
    description: data.description,
    cue: data.cue,
    why: data.why,
    default_target_kind: data.defaultTargetKind,
    default_target_value: data.defaultTargetValue,
  };

  // If coach chose to overwrite an existing move, target that row.
  const targetId = data.overwriteMoveId ?? data.id;

  // Conflict check: skip when overwriting explicitly.
  if (!data.overwriteMoveId) {
    const conflict = await findNameConflict(supabase, coachId, data.name, data.id);
    if (conflict) return { ok: false, conflict };
  }

  if (targetId) {
    const { data: updated, error } = await supabase
      .from("moves")
      .update(row)
      .eq("id", targetId)
      .eq("coach_id", coachId)
      .select(MOVE_COLUMNS)
      .single();
    if (error) dbError(error);
    return { ok: true, move: toDTO(updated) };
  }

  const { data: inserted, error } = await supabase
    .from("moves")
    .insert(row)
    .select(MOVE_COLUMNS)
    .single();
  if (error) dbError(error);
  return { ok: true, move: toDTO(inserted) };
}

/* ---------------- bulk import (.csv on iOS) ---------------- */

export const MAX_IMPORT_MOVES = 500;

/**
 * One row of a library import. A name matching a live move (same rule as
 * `findNameConflict`: trimmed, case-insensitive) is skipped unless the coach
 * chose `overwrite` for that row in review.
 */
export const importMoveRowInput = moveInput
  .omit({ id: true, overwriteMoveId: true })
  .extend({ onConflict: z.enum(["skip", "overwrite"]).default("skip") });

export const importMovesInput = z.object({
  moves: z.array(importMoveRowInput).min(1).max(MAX_IMPORT_MOVES),
});

export type ImportMoveOutcome = {
  /** Position in the request's `moves`, so the client can line results up with its rows. */
  index: number;
  name: string;
  status: "created" | "updated" | "skipped";
  reason?: "name_exists" | "duplicate_in_file";
  moveId?: string;
};

export type ImportMovesResult = {
  results: ImportMoveOutcome[];
  created: number;
  updated: number;
  skipped: number;
};

/**
 * Creates many library moves at once. New moves go in one insert; chosen
 * overwrites update the existing row in place (plan links to it survive).
 * A name repeated inside the same file keeps its first row only.
 */
export async function importMoves(
  ctx: MovesContext,
  input: z.infer<typeof importMovesInput>,
): Promise<ImportMovesResult> {
  const supabase = ctx.supabase;
  const coachId = await requireCoachId(ctx);

  const { data: live, error: liveErr } = await supabase
    .from("moves")
    .select("id, name")
    .eq("coach_id", coachId)
    .is("archived_at", null);
  if (liveErr) dbError(liveErr);
  const existing = new Map<string, string>();
  for (const r of live ?? []) {
    const key = normalizeName(r.name as string);
    if (!existing.has(key)) existing.set(key, r.id as string);
  }

  const results: ImportMoveOutcome[] = [];
  const seen = new Set<string>();
  const inserts: { index: number; row: Record<string, unknown> }[] = [];
  const updates: { index: number; id: string; row: Record<string, unknown> }[] = [];

  input.moves.forEach((m, index) => {
    const name = m.name.trim();
    const key = normalizeName(name);
    if (seen.has(key)) {
      results.push({ index, name, status: "skipped", reason: "duplicate_in_file" });
      return;
    }
    seen.add(key);
    const row = {
      sport: m.sport,
      category: m.category.trim(),
      name,
      description: m.description,
      cue: m.cue,
      why: m.why,
      default_target_kind: m.defaultTargetKind,
      default_target_value: m.defaultTargetValue,
    };
    const existingId = existing.get(key);
    if (existingId) {
      if (m.onConflict === "overwrite") updates.push({ index, id: existingId, row });
      else
        results.push({ index, name, status: "skipped", reason: "name_exists", moveId: existingId });
      return;
    }
    inserts.push({ index, row: { ...row, coach_id: coachId } });
  });

  if (inserts.length > 0) {
    const { data, error } = await supabase
      .from("moves")
      .insert(inserts.map((i) => i.row) as never)
      .select("id, name");
    if (error) dbError(error);
    const idByName = new Map(
      (data ?? []).map((r) => [normalizeName(r.name as string), r.id as string]),
    );
    for (const i of inserts) {
      const name = i.row.name as string;
      results.push({
        index: i.index,
        name,
        status: "created",
        moveId: idByName.get(normalizeName(name)),
      });
    }
  }

  for (const u of updates) {
    const { error } = await supabase
      .from("moves")
      .update(u.row as never)
      .eq("id", u.id)
      .eq("coach_id", coachId);
    if (error) dbError(error);
    results.push({ index: u.index, name: u.row.name as string, status: "updated", moveId: u.id });
  }

  results.sort((a, b) => a.index - b.index);
  const count = (s: ImportMoveOutcome["status"]) => results.filter((r) => r.status === s).length;
  return {
    results,
    created: count("created"),
    updated: count("updated"),
    skipped: count("skipped"),
  };
}

export async function archiveMove(
  ctx: MovesContext,
  id: string,
  now: Date = new Date(),
): Promise<{ ok: true }> {
  const coachId = await requireCoachId(ctx);
  const { error } = await ctx.supabase
    .from("moves")
    .update({ archived_at: now.toISOString() })
    .eq("id", id)
    .eq("coach_id", coachId);
  if (error) dbError(error);
  return { ok: true };
}

/* ---------------- plan move → library ---------------- */

type PlanMoveRow = {
  id: string;
  plan_id?: string;
  move_id: string | null;
  name: string;
  description: string | null;
  cue: string | null;
  why: string | null;
  target_kind: string;
  target_value: number;
  plans: { coach_id: string };
};

async function loadOwnedPlanMove(
  supabase: Client,
  coachId: string,
  planMoveId: string,
): Promise<PlanMoveRow> {
  const { data: pm, error: pmErr } = await supabase
    .from("plan_moves")
    .select(
      "id, plan_id, move_id, name, description, cue, why, target_kind, target_value, plans!inner(coach_id)",
    )
    .eq("id", planMoveId)
    .maybeSingle();
  if (pmErr) dbError(pmErr);
  if (!pm) throw notFound("Move not found");
  const row = pm as unknown as PlanMoveRow;
  if (row.plans.coach_id !== coachId) {
    throw new ApiError({ code: "forbidden", status: 403, message: "Not authorized" });
  }
  return row;
}

function requireCueAndWhy(pm: PlanMoveRow, message: string): { cue: string; why: string } {
  const cue = (pm.cue ?? "").trim();
  const why = (pm.why ?? "").trim();
  if (!cue || !why) throw unprocessable(message);
  return { cue, why };
}

export const addPlanMoveToLibraryInput = z.object({
  planMoveId: z.string().uuid(),
  sport: z.string().min(1).max(64),
  category: z.string().min(1).max(64),
  overwriteMoveId: z.string().uuid().optional(),
});

/** Save a plan-only move into the library and link the plan move to it. */
export async function addPlanMoveToLibrary(
  ctx: MovesContext,
  data: z.infer<typeof addPlanMoveToLibraryInput>,
): Promise<LibraryLinkResult> {
  const supabase = ctx.supabase;
  const coachId = await requireCoachId(ctx);
  const pm = await loadOwnedPlanMove(supabase, coachId, data.planMoveId);
  if (pm.move_id) return { ok: true, moveId: pm.move_id };

  const { cue, why } = requireCueAndWhy(
    pm,
    "Add a cue and a why before saving this move to your library",
  );

  if (!data.overwriteMoveId) {
    const conflict = await findNameConflict(supabase, coachId, pm.name);
    if (conflict) return { ok: false, conflict };
  }

  const fields = {
    sport: data.sport,
    category: data.category,
    name: pm.name,
    description: pm.description ?? "",
    cue,
    why,
    default_target_kind: pm.target_kind,
    default_target_value: pm.target_value,
  };

  let libraryMoveId: string;
  if (data.overwriteMoveId) {
    const { error: updErr } = await supabase
      .from("moves")
      .update(fields)
      .eq("id", data.overwriteMoveId)
      .eq("coach_id", coachId);
    if (updErr) dbError(updErr);
    libraryMoveId = data.overwriteMoveId;
  } else {
    const { data: inserted, error } = await supabase
      .from("moves")
      .insert({ coach_id: coachId, ...fields })
      .select("id")
      .single();
    if (error) dbError(error);
    libraryMoveId = inserted.id as string;
  }

  const { error: linkErr } = await supabase
    .from("plan_moves")
    .update({ move_id: libraryMoveId })
    .eq("id", pm.id);
  if (linkErr) dbError(linkErr);

  return { ok: true, moveId: libraryMoveId };
}

/**
 * Push a plan move's edits onto the library move it is linked to. When the
 * API names the library move in its path, `expectedMoveId` must be that link.
 */
export async function updateLibraryMoveFromPlanMove(
  ctx: MovesContext,
  planMoveId: string,
  expectedMoveId?: string,
): Promise<{ moveId: string }> {
  const supabase = ctx.supabase;
  const coachId = await requireCoachId(ctx);
  const pm = await loadOwnedPlanMove(supabase, coachId, planMoveId);
  if (!pm.move_id) throw unprocessable("This move is not linked to a library move yet");
  if (expectedMoveId && pm.move_id !== expectedMoveId) {
    throw unprocessable("This move is linked to a different library move");
  }

  const { cue, why } = requireCueAndWhy(pm, "Add a cue and a why before updating the library move");

  // Prevent updating this library move to a name already used by another.
  const conflict = await findNameConflict(supabase, coachId, pm.name, pm.move_id);
  if (conflict) {
    throw new ApiError({
      code: "name_conflict",
      status: 409,
      message: `Another move in your library is already named "${conflict.name}". Rename this move first, then update the library.`,
      details: { conflict },
    });
  }

  const { error: updErr } = await supabase
    .from("moves")
    .update({
      name: pm.name,
      description: pm.description ?? "",
      cue,
      why,
      default_target_kind: pm.target_kind,
      default_target_value: pm.target_value,
    })
    .eq("id", pm.move_id)
    .eq("coach_id", coachId);
  if (updErr) dbError(updErr);

  return { moveId: pm.move_id };
}

export const forkPlanMoveToLibraryInput = z.object({
  planMoveId: z.string().uuid(),
  sport: z.string().min(1).max(64),
  category: z.string().min(1).max(64),
  name: z.string().min(1).max(120).optional(),
  overwriteMoveId: z.string().uuid().optional(),
});

/** Fork a plan move's edits into a new library move (optionally renamed) and relink the plan move. */
export async function forkPlanMoveToLibrary(
  ctx: MovesContext,
  data: z.infer<typeof forkPlanMoveToLibraryInput>,
): Promise<LibraryLinkResult> {
  const supabase = ctx.supabase;
  const coachId = await requireCoachId(ctx);
  const pm = await loadOwnedPlanMove(supabase, coachId, data.planMoveId);

  const { cue, why } = requireCueAndWhy(
    pm,
    "Add a cue and a why before saving this move to your library",
  );

  const newName = (data.name ?? pm.name).trim();
  if (!newName) throw unprocessable("Name is required");

  if (!data.overwriteMoveId) {
    const conflict = await findNameConflict(supabase, coachId, newName);
    if (conflict) return { ok: false, conflict };
  }

  const fields = {
    sport: data.sport,
    category: data.category,
    name: newName,
    description: pm.description ?? "",
    cue,
    why,
    default_target_kind: pm.target_kind,
    default_target_value: pm.target_value,
  };

  let libraryMoveId: string;
  if (data.overwriteMoveId) {
    const { error: updErr } = await supabase
      .from("moves")
      .update(fields)
      .eq("id", data.overwriteMoveId)
      .eq("coach_id", coachId);
    if (updErr) dbError(updErr);
    libraryMoveId = data.overwriteMoveId;
  } else {
    const { data: inserted, error } = await supabase
      .from("moves")
      .insert({ coach_id: coachId, ...fields })
      .select("id")
      .single();
    if (error) dbError(error);
    libraryMoveId = inserted.id as string;
  }

  const planMoveUpdate: { move_id: string; name?: string } = { move_id: libraryMoveId };
  if (newName !== pm.name) planMoveUpdate.name = newName;
  const { error: linkErr } = await supabase
    .from("plan_moves")
    .update(planMoveUpdate)
    .eq("id", pm.id);
  if (linkErr) dbError(linkErr);

  return { ok: true, moveId: libraryMoveId };
}
