import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

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
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Coach profile not found");
  return data.id;
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
    const coachId = await getCoachId(supabase, context.userId);

    // Idempotent seed if first visit
    await supabase.rpc("seed_coach_library", { _coach_id: coachId });

    const { data, error } = await supabase
      .from("moves")
      .select(
        "id, sport, category, name, description, cue, why, default_target_kind, default_target_value",
      )
      .eq("coach_id", coachId)
      .is("archived_at", null)
      .order("category", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);

    // Curriculum categories from seed_moves (all sports — small table)
    const { data: seeds } = await supabase
      .from("seed_moves")
      .select("sport, category");

    return {
      moves: (data ?? []).map(toDTO),
      seedCategories: seeds ?? [],
    };
  });



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

    if (data.id) {
      const { data: updated, error } = await supabase
        .from("moves")
        .update(row)
        .eq("id", data.id)
        .eq("coach_id", coachId)
        .select(
          "id, sport, category, name, description, cue, why, default_target_kind, default_target_value",
        )
        .single();
      if (error) throw new Error(error.message);
      return { move: toDTO(updated) };
    }

    const { data: inserted, error } = await supabase
      .from("moves")
      .insert(row)
      .select(
        "id, sport, category, name, description, cue, why, default_target_kind, default_target_value",
      )
      .single();
    if (error) throw new Error(error.message);
    return { move: toDTO(inserted) };
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
    if (error) throw new Error(error.message);
    return { ok: true };
  });
