import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { ApiError } from "@/lib/api/errors";
import { requireContext } from "@/lib/api/auth";
import { registerLiveActivityTokenInput } from "@/lib/api/live-activities-schema";
import { okSchema } from "@/lib/api/onboarding-schema";
import { registerLiveActivityToken } from "@/lib/live-activities.server";

/**
 * Register (or refresh) a Live Activity push token (PRD §6.6 "Live
 * Activities"): the device's push-to-start token, or one activity's update
 * token together with its `activityKey`. Idempotent on the token.
 */
export const Route = createFileRoute("/api/v1/live-activities/tokens/")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/live-activities/tokens",
      operationId: "registerLiveActivityToken",
      auth: "user",
      summary: "Register a Live Activity push-to-start or update token",
      input: registerLiveActivityTokenInput,
      output: okSchema,
      idempotent: true,
      handler: async ({ ctx, input }) => {
        const { userId, supabase } = requireContext(ctx);
        if (input.kind === "board_update" && !input.activityKey) {
          throw new ApiError({
            code: "validation_failed",
            status: 400,
            message: "activityKey is required for a board_update token.",
          });
        }
        return registerLiveActivityToken({ userId, supabase }, input);
      },
    }),
  },
});
