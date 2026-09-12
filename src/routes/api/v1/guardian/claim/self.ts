import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { guardianClaimResultSchema } from "@/lib/api/guardian-schema";
import { claimAthleteSelf, claimAthleteSelfInput } from "@/lib/guardian-claim.server";

/**
 * Thin wrapper over the shared `claimAthleteSelf` (PRD §3.5, Appendix A
 * "Guardians"): an adult athlete takes over the pending row behind an
 * athlete-addressed invite. `apiContract` refuses a link that was sent to a
 * parent or guardian (403 `forbidden`, D4). `[idem]`: a retried claim never
 * trips the "already claimed" check on its own first success.
 */
export const Route = createFileRoute("/api/v1/guardian/claim/self")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/guardian/claim/self",
      operationId: "claimAthleteSelf",
      auth: "user",
      idempotent: true,
      rateLimit: { windowSeconds: 3600, max: 20 },
      summary: "Take over the athlete behind an athlete-addressed invite as the signed-in adult",
      input: claimAthleteSelfInput,
      output: guardianClaimResultSchema,
      handler: async ({ ctx, input }) => {
        const { admin, userId } = requireContext(ctx);
        return claimAthleteSelf(admin, userId, input, { apiContract: true });
      },
    }),
  },
});
