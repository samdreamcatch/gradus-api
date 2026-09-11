import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { guardianClaimResultSchema } from "@/lib/api/guardian-schema";
import { claimGuardianAthlete, claimGuardianAthleteInput } from "@/lib/guardian-claim.server";

/**
 * Thin wrapper over the shared `claimGuardianAthlete` (PRD §3.5, Appendix A
 * "Guardians"): the parent claims the athlete behind the token into their
 * own parent profile (created on first claim). The athlete behind the link
 * can't claim themselves (403 `forbidden`, shared with the web), and with
 * `apiContract` a caller whose own athlete row is a minor is refused for any
 * link (403 `wrong_role`) — a child account never becomes a parent. `[idem]`:
 * a retried claim never creates a second parent profile. After success the
 * client should refresh `GET /me` (the caller may have just become a parent)
 * and the parent settings.
 */
export const Route = createFileRoute("/api/v1/guardian/claim/")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/guardian/claim",
      operationId: "claimGuardianAthlete",
      auth: "user",
      idempotent: true,
      rateLimit: { windowSeconds: 3600, max: 20 },
      summary: "Claim the athlete behind a guardian link into the caller's parent profile",
      input: claimGuardianAthleteInput,
      output: guardianClaimResultSchema,
      handler: async ({ ctx, input }) => {
        const { admin, userId } = requireContext(ctx);
        return claimGuardianAthlete(admin, userId, input, { apiContract: true });
      },
    }),
  },
});
