/**
 * Per-athlete practice expectations (PRD §7.2 "Practice targets"): a coach
 * can override the Gradus / level default for one athlete in one sport.
 * Single source of truth for practice-targets.functions.ts and
 * `PUT/DELETE /api/v1/coach/athletes/{id}/practice-target`. Writes go through
 * the caller's RLS client, as on the web.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

export type PracticeTargetContext = { userId: string; supabase: Client };

async function requireCoachId(supabase: Client, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) {
    throw new ApiError({ code: "unprocessable", status: 422, message: "Coach profile not found" });
  }
  return data.id as string;
}

const NOT_ON_ROSTER = "Athlete is not on your roster";

/**
 * The caller must coach this athlete. Mirrors the roster clause of the
 * "Coach manages own practice targets" policy (read through the same RLS
 * client, so the two cannot disagree). One answer for "not on your roster" and
 * "no such athlete", so athlete ids cannot be probed.
 */
async function assertAthleteOnRoster(supabase: Client, coachId: string, athleteId: string) {
  const { data, error } = await supabase
    .from("coach_athletes")
    .select("athlete_id")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) {
    throw new ApiError({ code: "forbidden", status: 403, message: NOT_ON_ROSTER });
  }
}

export const practiceTargetInput = z.object({
  sport: z.string().min(1).max(64),
  hoursPerWeek: z.number().min(0).max(40),
});

/** `setPracticeTarget`: upsert the coach's weekly hours for (athlete, sport). */
export async function setPracticeTarget(
  ctx: PracticeTargetContext,
  athleteId: string,
  data: z.infer<typeof practiceTargetInput>,
  now: Date = new Date(),
): Promise<{ ok: true }> {
  const coachId = await requireCoachId(ctx.supabase, ctx.userId);
  await assertAthleteOnRoster(ctx.supabase, coachId, athleteId);
  const { error } = await ctx.supabase.from("coach_athlete_practice_targets").upsert(
    {
      coach_id: coachId,
      athlete_id: athleteId,
      sport: data.sport,
      hours_per_week: data.hoursPerWeek,
      updated_at: now.toISOString(),
    },
    { onConflict: "coach_id,athlete_id,sport" },
  );
  // The write is scoped to the caller's own coach_id, so the roster clause is the
  // only one that can fail with 42501.
  if (error?.code === "42501") {
    throw new ApiError({ code: "forbidden", status: 403, message: NOT_ON_ROSTER });
  }
  if (error) dbError(error);
  return { ok: true as const };
}

/**
 * `clearPracticeTarget`: back to the default for (athlete, sport). No roster
 * check, on purpose: a coach whose athlete has left can still clear what they
 * set (the database's policy allows the delete for the same reason).
 */
export async function clearPracticeTarget(
  ctx: PracticeTargetContext,
  athleteId: string,
  sport: string,
): Promise<{ ok: true }> {
  const coachId = await requireCoachId(ctx.supabase, ctx.userId);
  const { error } = await ctx.supabase
    .from("coach_athlete_practice_targets")
    .delete()
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId)
    .eq("sport", sport);
  if (error) dbError(error);
  return { ok: true as const };
}
