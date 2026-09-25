import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { startParentVerificationResultSchema } from "@/lib/api/guardian-verification-schema";
import { startParentVerification } from "@/lib/guardian-verification.server";

/**
 * Thin wrapper over the shared `startParentVerification` (PRD §6.13 A1–A2):
 * asks KWS to email the signed-in parent their adult-verification link. The
 * address is the parent's own account email. Six per hour per user, well
 * under KWS's own ten-per-hour-per-email limit; a second tap within a minute
 * re-uses the email already on its way.
 */
export const Route = createFileRoute("/api/v1/guardian/verification/start")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/guardian/verification/start",
      operationId: "startParentVerification",
      auth: "user",
      summary: "Email the signed-in parent their KWS adult-verification link",
      output: startParentVerificationResultSchema,
      rateLimit: { windowSeconds: 3600, max: 6 },
      handler: async ({ ctx }) => {
        const { admin, userId } = requireContext(ctx);
        return startParentVerification(admin, userId);
      },
    }),
  },
});
