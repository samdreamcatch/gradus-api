import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

/**
 * Per-athlete practice expectations. A coach can override the Gradus / level
 * default for one athlete in one sport; parents and athletes see the override
 * on their goals dashboard.
 */

async function requireCoachId(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw new Error("Coach profile not found");
  return data.id as string;
}

export const setPracticeTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        athleteId: z.string().uuid(),
        sport: z.string().min(1).max(64),
        hoursPerWeek: z.number().min(0).max(40),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const coachId = await requireCoachId(context.supabase, context.userId);
    const { error } = await context.supabase.from("coach_athlete_practice_targets").upsert(
      {
        coach_id: coachId,
        athlete_id: data.athleteId,
        sport: data.sport,
        hours_per_week: data.hoursPerWeek,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "coach_id,athlete_id,sport" },
    );
    if (error) dbError(error);
    return { ok: true as const };
  });

export const clearPracticeTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ athleteId: z.string().uuid(), sport: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const coachId = await requireCoachId(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("coach_athlete_practice_targets")
      .delete()
      .eq("coach_id", coachId)
      .eq("athlete_id", data.athleteId)
      .eq("sport", data.sport);
    if (error) dbError(error);
    return { ok: true as const };
  });
