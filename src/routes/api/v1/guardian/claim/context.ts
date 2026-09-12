import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { guardianClaimContextSchema } from "@/lib/api/guardian-schema";
import { getGuardianClaimContext } from "@/lib/guardian-claim.server";

/**
 * Thin wrapper over the shared `getGuardianClaimContext` (PRD §3.5, Appendix
 * A "Guardians"): whether the signed-in claimer already has a parent profile,
 * so the claim screen can say "Signed in as …" and skip the name fields.
 */
export const Route = createFileRoute("/api/v1/guardian/claim/context")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/guardian/claim/context",
      operationId: "getGuardianClaimContext",
      auth: "user",
      summary: "Whether the signed-in claimer already has a parent profile, and their name",
      output: guardianClaimContextSchema,
      handler: async ({ ctx }) => {
        const { admin, userId } = requireContext(ctx);
        return getGuardianClaimContext(admin, userId);
      },
    }),
  },
});
