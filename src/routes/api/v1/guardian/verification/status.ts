import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { parentVerificationResponseSchema } from "@/lib/api/guardian-verification-schema";
import { getParentVerificationForUser } from "@/lib/guardian-verification.server";

/**
 * Thin wrapper over the shared `getParentVerificationForUser` (PRD §6.13
 * A1): whether the signed-in parent is a verified adult, whether the gates
 * are on, and whether KWS is configured. `{ verification: null }` when the
 * caller has no parent profile. Polled by the "check your email" screen.
 */
export const Route = createFileRoute("/api/v1/guardian/verification/status")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/guardian/verification/status",
      operationId: "getParentVerificationStatus",
      auth: "user",
      summary: "The signed-in parent's adult-verification state",
      output: parentVerificationResponseSchema,
      rateLimit: { windowSeconds: 60, max: 60 },
      handler: async ({ ctx }) => {
        const { admin, userId } = requireContext(ctx);
        return { verification: await getParentVerificationForUser(admin, userId) };
      },
    }),
  },
});
