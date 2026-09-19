import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
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
        const { userId, admin } = requireContext(ctx);
        return registerLiveActivityToken({ userId, admin }, input);
      },
    }),
  },
});
