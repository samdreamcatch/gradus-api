import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { guardianStatusResponseSchema } from "@/lib/api/guardian-schema";
import { getMyGuardianStatus } from "@/lib/guardian-claim.server";

/**
 * Thin wrapper over the shared `getMyGuardianStatus` (PRD §3.5, §7.8,
 * Appendix A "Guardians"): the signed-in athlete's own guardian-on-file
 * state. `{ status: null }` when the caller has no athlete row. The server
 * owns the "minor" rule here (`apiContract`, D8): calendar age under 18, and
 * an unknown birthdate counts as a minor.
 */
export const Route = createFileRoute("/api/v1/guardian/status")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/guardian/status",
      operationId: "getMyGuardianStatus",
      auth: "user",
      summary:
        "The signed-in athlete's guardian-on-file status (isMinor, email, claimed, invitedAt)",
      output: guardianStatusResponseSchema,
      handler: async ({ ctx }) => {
        const { admin, userId } = requireContext(ctx);
        return { status: await getMyGuardianStatus(admin, userId, { apiContract: true }) };
      },
    }),
  },
});
