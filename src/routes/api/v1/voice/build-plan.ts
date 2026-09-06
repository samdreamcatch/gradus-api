import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { voiceApplyResultSchema, voiceBuildInput } from "@/lib/api/plans-schema";
import { buildPlanFromVoice } from "@/lib/voice.server";

/**
 * Thin wrapper over the shared `buildPlanFromVoice` (PRD §7.4 "Voice FAB"):
 * a `multipart/form-data` upload (`audio`, `mode` = create | edit, `planId`
 * for edit) is transcribed with the coach's move names as hints, parsed into
 * a plan draft or edits, and applied. `[idem]`: a retried upload never
 * creates a second plan. The result names every AI-touched field.
 */
export const Route = createFileRoute("/api/v1/voice/build-plan")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/voice/build-plan",
      operationId: "voiceBuildPlan",
      auth: "user",
      idempotent: true,
      body: "multipart",
      rateLimit: { windowSeconds: 60, max: 10 },
      summary: "Build or edit a plan from a voice recording",
      input: voiceBuildInput,
      output: voiceApplyResultSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase } = requireContext(ctx);
        if (input.mode === "edit" && !input.planId) {
          throw new ApiError({
            code: "validation_failed",
            status: 400,
            message: "Missing planId for edit",
          });
        }
        return buildPlanFromVoice({ userId, supabase }, input);
      },
    }),
  },
});
