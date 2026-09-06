import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { transcriptSchema, voiceTranscribeInput } from "@/lib/api/plans-schema";
import { transcribeAudio } from "@/lib/voice.server";

/**
 * Thin wrapper over the shared `transcribeAudio` (PRD §6.7 "Transcription
 * endpoint changes", §7.4): a `multipart/form-data` upload named `audio`
 * (`audio/mp4` from iOS, `audio/webm` from browsers; 18 MB cap, 413
 * `payload_too_large`) answers the transcript. The service's own failures
 * are 503 `voice_unavailable`.
 */
export const Route = createFileRoute("/api/v1/voice/transcribe")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/voice/transcribe",
      operationId: "voiceTranscribe",
      auth: "user",
      body: "multipart",
      partContentTypes: { audio: "audio/mp4" },
      rateLimit: { windowSeconds: 60, max: 10 },
      summary: "Transcribe a voice recording",
      input: voiceTranscribeInput,
      output: transcriptSchema,
      handler: async ({ ctx, input }) => {
        requireContext(ctx);
        return transcribeAudio(input.audio);
      },
    }),
  },
});
