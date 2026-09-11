import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { revokeGuardianInvite } from "@/lib/team-guardians.server";

/**
 * Thin wrapper over the shared `revokeGuardianInvite` (PRD §7.7, Appendix
 * A). `{id}` is `guardian_invites.id` (the `invites[].id` from
 * `listTeamGuardians`). Only the inviting parent's own pending invites;
 * 404 `not_found` when nothing matched (the web answers a silent ok).
 */
export const Route = createFileRoute("/api/v1/parent/team/guardians/invites/$id/")({
  server: {
    handlers: defineApiRoute({
      method: "DELETE",
      path: "/api/v1/parent/team/guardians/invites/{id}",
      operationId: "revokeTeamGuardianInvite",
      auth: "user",
      summary: "Revoke a pending guardian invite",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { admin, userId } = requireContext(ctx);
        return revokeGuardianInvite(
          admin,
          userId,
          { inviteId: z.string().uuid().parse(params.id) },
          { apiContract: true },
        );
      },
    }),
  },
});
