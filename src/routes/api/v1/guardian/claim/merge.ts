import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { guardianClaimResultSchema } from "@/lib/api/guardian-schema";
import { mergeGuardianClaim, mergeGuardianClaimInput } from "@/lib/guardian-claim.server";

/**
 * Thin wrapper over the shared `mergeGuardianClaim` (PRD §3.5, Appendix A
 * "Guardians"): "that's my existing athlete" — carries the coach links,
 * sports and lesson slots from the pending athlete onto `athleteId` (one of
 * the caller's own) and deletes the pending row. Destructive and
 * non-transactional (parity with the web); online-only on iOS. `[idem]`: a
 * retry after the delete lands answers from the stored response instead of
 * failing on a vanished token.
 */
export const Route = createFileRoute("/api/v1/guardian/claim/merge")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/guardian/claim/merge",
      operationId: "mergeGuardianClaim",
      auth: "user",
      idempotent: true,
      rateLimit: { windowSeconds: 3600, max: 20 },
      summary: "Merge the pending athlete behind a guardian link into one of the caller's athletes",
      input: mergeGuardianClaimInput,
      output: guardianClaimResultSchema,
      handler: async ({ ctx, input }) => {
        const { admin, userId } = requireContext(ctx);
        return mergeGuardianClaim(admin, userId, input);
      },
    }),
  },
});
