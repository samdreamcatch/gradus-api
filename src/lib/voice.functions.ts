import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rethrowPlain } from "./api/errors";
import { assertVoiceAllowed } from "./minor-voice.server";
import {
  MAX_AUDIO_BYTES,
  buildPlanFromVoice,
  transcribeAudio,
  type ApplyResult,
  type Client,
} from "./voice.server";

// Re-export types so existing callers keep working.
export type { FieldSource, VoicePlanDraft, VoiceSources, VoiceTouched } from "./voice-types";

/*
 * Thin wrappers over the shared entry points in src/lib/voice.server.ts,
 * shared with `POST /api/v1/voice/transcribe` and `/api/v1/voice/build-plan`.
 * Behavior and error messages are unchanged.
 */

export const voiceTranscribe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    if (!(input instanceof FormData)) throw new Error("Expected FormData");
    const audio = input.get("audio");
    if (!(audio instanceof Blob)) throw new Error("Missing audio");
    if (audio.size > MAX_AUDIO_BYTES) {
      throw new Error("Recording too long — please keep voice notes under 3 minutes");
    }
    return { audio };
  })
  .handler(async ({ context, data }): Promise<{ text: string }> => {
    try {
      // An athlete under 18 never sends audio to the transcription service (#48).
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await assertVoiceAllowed(supabaseAdmin as Client, context.userId);
      return await transcribeAudio(data.audio);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const voiceBuildPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    if (!(input instanceof FormData)) throw new Error("Expected FormData");
    const audio = input.get("audio");
    const mode = input.get("mode");
    const planId = input.get("planId");
    if (!(audio instanceof Blob)) throw new Error("Missing audio");
    if (audio.size > MAX_AUDIO_BYTES) {
      throw new Error("Recording too long — please keep voice notes under 3 minutes");
    }
    if (mode !== "create" && mode !== "edit") throw new Error("Invalid mode");
    if (mode === "edit" && typeof planId !== "string") throw new Error("Missing planId for edit");
    return {
      audio,
      mode: mode as "create" | "edit",
      planId: typeof planId === "string" ? planId : undefined,
    };
  })
  .handler(async ({ context, data }): Promise<ApplyResult> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return await buildPlanFromVoice(
        {
          userId: context.userId,
          supabase: context.supabase as Client,
          admin: supabaseAdmin as Client,
        },
        data,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });
