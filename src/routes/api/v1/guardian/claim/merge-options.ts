import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { guardianMergeOptionsSchema } from "@/lib/api/guardian-schema";
import {
  getGuardianClaimMergeOptions,
  getGuardianClaimMergeOptionsInput,
} from "@/lib/guardian-claim.server";

/**
 * Thin wrapper over the shared `getGuardianClaimMergeOptions` (PRD §3.5,
 * Appendix A "Guardians"): the caller's OWN athletes ranked by how closely
 * they match the pending athlete, so the claim screen can offer "Yes, same
 * athlete". Read-only despite POST — the token travels in the body. Empty
 * for an unknown token or a caller without a parent profile.
 */
export const Route = createFileRoute("/api/v1/guardian/claim/merge-options")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/guardian/claim/merge-options",
      operationId: "getGuardianClaimMergeOptions",
      auth: "user",
      summary: "The caller's own athletes that may be the same person as the pending athlete",
      input: getGuardianClaimMergeOptionsInput,
      output: guardianMergeOptionsSchema,
      handler: async ({ ctx, input }) => {
        const { admin, userId } = requireContext(ctx);
        return getGuardianClaimMergeOptions(admin, userId, input);
      },
    }),
  },
});
