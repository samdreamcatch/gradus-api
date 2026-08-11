import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
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

type Client = SupabaseClient<Database>;

async function getCoachId(supabase: Client, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw new Error("Coach profile not found");
  return data.id;
}

async function findCoachId(supabase: Client, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
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

export const listMoves = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Client;
    const coachId = await findCoachId(supabase, context.userId);
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

    const { data, error } = await supabase
      .from("moves")
      .select(
        "id, sport, category, name, description, cue, why, default_target_kind, default_target_value",
      )
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
  });

export interface NameConflict {
  existingMoveId: string;
  name: string;
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

const moveInput = z.object({
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

export const upsertMove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => moveInput.parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);

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
      if (conflict) {
        return { ok: false as const, conflict };
      }
    }

    if (targetId) {
      const { data: updated, error } = await supabase
        .from("moves")
        .update(row)
        .eq("id", targetId)
        .eq("coach_id", coachId)
        .select(
          "id, sport, category, name, description, cue, why, default_target_kind, default_target_value",
        )
        .single();
      if (error) dbError(error);
      return { ok: true as const, move: toDTO(updated) };
    }

    const { data: inserted, error } = await supabase
      .from("moves")
      .insert(row)
      .select(
        "id, sport, category, name, description, cue, why, default_target_kind, default_target_value",
      )
      .single();
    if (error) dbError(error);
    return { ok: true as const, move: toDTO(inserted) };
  });

export const archiveMove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);
    const { error } = await supabase
      .from("moves")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("coach_id", coachId);
    if (error) dbError(error);
    return { ok: true };
  });

/* ---------------- Save a plan-only move into the coach library ---------------- */

const addPlanMoveToLibraryInput = z.object({
  planMoveId: z.string().uuid(),
  sport: z.string().min(1).max(64),
  category: z.string().min(1).max(64),
  overwriteMoveId: z.string().uuid().optional(),
});

export const addPlanMoveToLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => addPlanMoveToLibraryInput.parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);

    const { data: pm, error: pmErr } = await supabase
      .from("plan_moves")
      .select(
        "id, plan_id, move_id, name, description, cue, why, target_kind, target_value, plans!inner(coach_id)",
      )
      .eq("id", data.planMoveId)
      .maybeSingle();
    if (pmErr) dbError(pmErr);
    if (!pm) throw new Error("Move not found");
    const planCoachId = (pm as unknown as { plans: { coach_id: string } }).plans.coach_id;
    if (planCoachId !== coachId) throw new Error("Not authorized");
    if (pm.move_id) return { ok: true as const, moveId: pm.move_id as string };

    const cue = (pm.cue ?? "").trim();
    const why = (pm.why ?? "").trim();
    if (!cue || !why) {
      throw new Error("Add a cue and a why before saving this move to your library");
    }

    if (!data.overwriteMoveId) {
      const conflict = await findNameConflict(supabase, coachId, pm.name);
      if (conflict) {
        return { ok: false as const, conflict };
      }
    }

    let libraryMoveId: string;
    if (data.overwriteMoveId) {
      const { error: updErr } = await supabase
        .from("moves")
        .update({
          sport: data.sport,
          category: data.category,
          name: pm.name,
          description: pm.description ?? "",
          cue,
          why,
          default_target_kind: pm.target_kind,
          default_target_value: pm.target_value,
        })
        .eq("id", data.overwriteMoveId)
        .eq("coach_id", coachId);
      if (updErr) dbError(updErr);
      libraryMoveId = data.overwriteMoveId;
    } else {
      const { data: inserted, error } = await supabase
        .from("moves")
        .insert({
          coach_id: coachId,
          sport: data.sport,
          category: data.category,
          name: pm.name,
          description: pm.description ?? "",
          cue,
          why,
          default_target_kind: pm.target_kind,
          default_target_value: pm.target_value,
        })
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

    return { ok: true as const, moveId: libraryMoveId };
  });

/* ---------------- Update the linked library move from a plan move's fields ---------------- */

const updateLibraryFromPlanMoveInput = z.object({
  planMoveId: z.string().uuid(),
});

export const updateLibraryMoveFromPlanMove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateLibraryFromPlanMoveInput.parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);

    const { data: pm, error: pmErr } = await supabase
      .from("plan_moves")
      .select(
        "id, move_id, name, description, cue, why, target_kind, target_value, plans!inner(coach_id)",
      )
      .eq("id", data.planMoveId)
      .maybeSingle();
    if (pmErr) dbError(pmErr);
    if (!pm) throw new Error("Move not found");
    const planCoachId = (pm as unknown as { plans: { coach_id: string } }).plans.coach_id;
    if (planCoachId !== coachId) throw new Error("Not authorized");
    if (!pm.move_id) throw new Error("This move is not linked to a library move yet");

    const cue = (pm.cue ?? "").trim();
    const why = (pm.why ?? "").trim();
    if (!cue || !why) {
      throw new Error("Add a cue and a why before updating the library move");
    }

    // Prevent updating this library move to a name already used by another.
    const conflict = await findNameConflict(supabase, coachId, pm.name, pm.move_id);
    if (conflict) {
      throw new Error(
        `Another move in your library is already named "${conflict.name}". Rename this move first, then update the library.`,
      );
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

    return { moveId: pm.move_id as string };
  });

/* ---------------- Fork edits into a new library move ---------------- */

const forkPlanMoveToLibraryInput = z.object({
  planMoveId: z.string().uuid(),
  sport: z.string().min(1).max(64),
  category: z.string().min(1).max(64),
  name: z.string().min(1).max(120).optional(),
  overwriteMoveId: z.string().uuid().optional(),
});

export const forkPlanMoveToLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => forkPlanMoveToLibraryInput.parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);

    const { data: pm, error: pmErr } = await supabase
      .from("plan_moves")
      .select("id, name, description, cue, why, target_kind, target_value, plans!inner(coach_id)")
      .eq("id", data.planMoveId)
      .maybeSingle();
    if (pmErr) dbError(pmErr);
    if (!pm) throw new Error("Move not found");
    const planCoachId = (pm as unknown as { plans: { coach_id: string } }).plans.coach_id;
    if (planCoachId !== coachId) throw new Error("Not authorized");

    const cue = (pm.cue ?? "").trim();
    const why = (pm.why ?? "").trim();
    if (!cue || !why) {
      throw new Error("Add a cue and a why before saving this move to your library");
    }

    const newName = (data.name ?? pm.name).trim();
    if (!newName) throw new Error("Name is required");

    if (!data.overwriteMoveId) {
      const conflict = await findNameConflict(supabase, coachId, newName);
      if (conflict) {
        return { ok: false as const, conflict };
      }
    }

    let libraryMoveId: string;
    if (data.overwriteMoveId) {
      const { error: updErr } = await supabase
        .from("moves")
        .update({
          sport: data.sport,
          category: data.category,
          name: newName,
          description: pm.description ?? "",
          cue,
          why,
          default_target_kind: pm.target_kind,
          default_target_value: pm.target_value,
        })
        .eq("id", data.overwriteMoveId)
        .eq("coach_id", coachId);
      if (updErr) dbError(updErr);
      libraryMoveId = data.overwriteMoveId;
    } else {
      const { data: inserted, error } = await supabase
        .from("moves")
        .insert({
          coach_id: coachId,
          sport: data.sport,
          category: data.category,
          name: newName,
          description: pm.description ?? "",
          cue,
          why,
          default_target_kind: pm.target_kind,
          default_target_value: pm.target_value,
        })
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

    return { ok: true as const, moveId: libraryMoveId };
  });
