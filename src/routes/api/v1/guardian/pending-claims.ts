import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { guardianPendingClaimsSchema } from "@/lib/api/guardian-schema";
import { listMyPendingGuardianClaims } from "@/lib/guardian-claim.server";

/**
 * Thin wrapper over the shared `listMyPendingGuardianClaims` (beta feedback
 * 2026-10-07): athletes a coach added with this signed-in parent's email,
 * waiting for the parent to confirm. Each opens the `/g/<token>` claim.
 */
export const Route = createFileRoute("/api/v1/guardian/pending-claims")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/guardian/pending-claims",
      operationId: "getMyPendingGuardianClaims",
      auth: "user",
      summary:
        "Athletes a coach listed the signed-in parent as guardian for, waiting to be confirmed",
      output: guardianPendingClaimsSchema,
      handler: async ({ ctx }) => {
        const { admin, userId } = requireContext(ctx);
        return listMyPendingGuardianClaims(admin, userId);
      },
    }),
  },
});
