import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { coachContext, completeOnboarding } from "@/lib/coach-onboarding.server";

/**
 * Thin wrapper over the shared `completeOnboarding`: stamps `onboarded_at`
 * and, while the Founding Coach window is open, the complimentary
 * entitlement. `GET /me` reports `onboardingComplete: true` afterwards.
 */
export const Route = createFileRoute("/api/v1/coach/onboarding/complete")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/onboarding/complete",
      auth: "user",
      idempotent: true,
      summary: "Finish coach onboarding",
      output: okSchema,
      handler: async ({ ctx }) => completeOnboarding(coachContext(requireContext(ctx))),
    }),
  },
});
