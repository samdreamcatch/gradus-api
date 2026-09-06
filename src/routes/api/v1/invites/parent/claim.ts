import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { parentClaimResultSchema } from "@/lib/api/onboarding-schema";
import { claimInviteInput, claimParentInvite } from "@/lib/invites.server";

/**
 * Thin wrapper over the shared `claimParentInvite`: an onboarded coach
 * links every athlete under the inviting parent. Idempotent, so a retry
 * after a dropped connection is safe.
 */
export const Route = createFileRoute("/api/v1/invites/parent/claim")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/invites/parent/claim",
      auth: "user",
      idempotent: true,
      summary: "Claim a parent invite as a coach",
      input: claimInviteInput,
      output: parentClaimResultSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return claimParentInvite({ userId, admin }, input);
      },
    }),
  },
});
