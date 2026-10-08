import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { isMinorOrUnconfirmed } from "./athlete-age";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

/**
 * Voice is off for athletes under 18 (PRD decision #48, 2026-10-07; replaces the
 * minors' exception in #37). Their audio must never reach the transcription
 * service: ElevenLabs' terms forbid voice data from anyone under 18, and it keeps
 * speech-to-text audio and transcripts, which the COPPA audio exception (delete
 * the recording right after use) does not allow. So the server refuses before it
 * reads the clip into any request.
 */
export const MINOR_VOICE_MESSAGE = "Voice isn't available for athletes under 18. Type it instead.";

/**
 * Whether this login may use voice as an athlete: `null` when it has no athlete
 * row (a coach, a parent), otherwise true only when every athlete row it has is
 * a confirmed adult. Judged per login and conservatively (`isMinorOrUnconfirmed`):
 * an athlete with no usable birthdate counts as under 18, and a second athlete
 * row (an existing policy allows one) can't be used to get around it. Read with
 * the admin client where the caller has one, so RLS can't hide a row.
 */
export async function athleteVoiceAllowed(client: Client, userId: string): Promise<boolean | null> {
  const { data, error } = await client.from("athletes").select("birthdate").eq("user_id", userId);
  if (error) dbError(error);
  const rows = (data ?? []) as { birthdate: string | null }[];
  if (rows.length === 0) return null;
  return rows.every((row) => !isMinorOrUnconfirmed(row.birthdate));
}

/** Refuses voice for an athlete under 18 (or with no birthdate on file): 403 `text_only`. */
export async function assertVoiceAllowed(client: Client, userId: string): Promise<void> {
  if ((await athleteVoiceAllowed(client, userId)) === false) {
    throw new ApiError({ code: "text_only", status: 403, message: MINOR_VOICE_MESSAGE });
  }
}
