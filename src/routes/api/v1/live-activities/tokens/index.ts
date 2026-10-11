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
 *
 * Not `idempotent: true`, for the reason in `../../devices/index.ts`: the
 * app's `Idempotency-Key` is built from the token alone, so after
 * `DELETE /live-activities/tokens/{token}` a re-register within 24 hours
 * replayed the stored 200 and left no row.
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
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return registerLiveActivityToken({ userId, admin }, input);
      },
    }),
  },
});
