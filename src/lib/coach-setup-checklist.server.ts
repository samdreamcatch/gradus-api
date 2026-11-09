/**
 * The coach's setup checklist (migration 20261111120200_coach_profiles_checklist):
 * four steps the app reports as the coach completes them, stored in
 * `coach_profiles.checklist`. `GET /api/v1/coach/profile` returns it as
 * `profile.checklist`; `PATCH /api/v1/coach/profile` marks steps, usually one
 * at a time: `{ "checklist": { "identityVerification": true } }`.
 *
 * `coach_profiles.checklist` and `merge_coach_checklist` aren't in the
 * generated types until Lovable regenerates them, so they go through `untyped`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import type { CoachSetupChecklist } from "./coach-profile-types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

type Untyped = {
  from: (table: "coach_profiles") => any;
  rpc: (fn: "merge_coach_checklist", args: { _patch: Record<string, boolean> }) => any;
};
const untyped = (client: Client) => client as unknown as Untyped;

export const coachSetupChecklistSchema = z.object({
  identityVerification: z.boolean(),
  payoutSetup: z.boolean(),
  uploadProfilePhoto: z.boolean(),
  saveFirstPlan: z.boolean(),
}) satisfies z.ZodType<CoachSetupChecklist>;

/** `PATCH /api/v1/coach/profile`: the whole checklist after the update. */
export const coachSetupChecklistResponseSchema = z.object({
  checklist: coachSetupChecklistSchema,
});

/** One or more steps; a key outside the four is refused, not dropped. */
export const updateCoachSetupChecklistInput = z.object({
  checklist: coachSetupChecklistSchema
    .partial()
    .strict()
    .refine((steps) => Object.keys(steps).length > 0, "Send at least one checklist step."),
});

/** Every step, false where the stored value is missing or not a boolean. */
export function normalizeCoachSetupChecklist(stored: unknown): CoachSetupChecklist {
  const value = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  return {
    identityVerification: value.identityVerification === true,
    payoutSetup: value.payoutSetup === true,
    uploadProfilePhoto: value.uploadProfilePhoto === true,
    saveFirstPlan: value.saveFirstPlan === true,
  };
}

/** The caller's checklist; all false when they have no coach profile. */
export async function getCoachSetupChecklist(
  supabase: Client,
  userId: string,
): Promise<CoachSetupChecklist> {
  const { data, error } = await untyped(supabase)
    .from("coach_profiles")
    .select("checklist")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  return normalizeCoachSetupChecklist(data?.checklist);
}

/** Marks the sent steps on the caller's checklist and returns all of it. */
export async function updateCoachSetupChecklist(
  supabase: Client,
  input: z.infer<typeof updateCoachSetupChecklistInput>,
): Promise<{ checklist: CoachSetupChecklist }> {
  const { data, error } = await untyped(supabase).rpc("merge_coach_checklist", {
    _patch: input.checklist as Record<string, boolean>,
  });
  if (error) dbError(error);
  if (data == null) {
    throw new ApiError({ code: "not_found", status: 404, message: "Coach profile not found." });
  }
  return { checklist: normalizeCoachSetupChecklist(data) };
}
