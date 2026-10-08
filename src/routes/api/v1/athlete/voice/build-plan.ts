import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { voiceApplyResultSchema, voiceBuildInput } from "@/lib/api/plans-schema";
import { buildAthletePlanFromVoice, withoutWords } from "@/lib/athlete-voice.server";

/**
 * Thin wrapper over the shared `buildAthletePlanFromVoice` (PRD §6.14 B,
 * decisions #37 and #48): a `multipart/form-data` upload (`audio`, `mode` =
 * create | edit, `planId` for edit) is transcribed with the curriculum's move
 * names as hints and built into a draft of the athlete's OWN plan, or edits to
 * one. Adult athletes only: under 18, or no birthdate on file, answers 403
 * `text_only` before anything is transcribed (#48). The audio is transcribed and
 * discarded (never stored, never logged), and only the transcript text is kept,
 * on the plan.
 * There is no athlete slot, so a spoken name is ignored. `[idem]`: a retried
 * upload never creates a second plan, and the 24-hour replay row keeps the
 * result without the transcript or its quotes (`withoutWords`).
 */
export const Route = createFileRoute("/api/v1/athlete/voice/build-plan")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/athlete/voice/build-plan",
      operationId: "athleteVoiceBuildPlan",
      auth: "user",
      idempotent: true,
      idempotencyStoredBody: withoutWords,
      body: "multipart",
      partContentTypes: { audio: "audio/mp4" },
      rateLimit: { windowSeconds: 60, max: 10 },
      summary: "Build or edit the athlete's own plan from a voice recording",
      input: voiceBuildInput,
      output: voiceApplyResultSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        if (input.mode === "edit" && !input.planId) {
          throw new ApiError({
            code: "validation_failed",
            status: 400,
            message: "Missing planId for edit",
          });
        }
        return buildAthletePlanFromVoice({ userId, supabase, admin }, input);
      },
    }),
  },
});
