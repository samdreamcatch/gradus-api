import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { deletionImpactSchema } from "@/lib/api/account-schema";
import { listOrphanedMinors } from "@/lib/account-deletion.server";

/**
 * Thin wrapper over the shared `listOrphanedMinors` (PRD §6.4 "Delete
 * account"): the minors who sign in themselves and whose only guardian is
 * the caller, so the delete sheet can ask what happens to each of them.
 */
export const Route = createFileRoute("/api/v1/me/deletion-impact")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/me/deletion-impact",
      operationId: "getDeletionImpact",
      auth: "user",
      summary: "Minors who would be left without a guardian if the caller deletes their account",
      output: deletionImpactSchema,
      handler: async ({ ctx }) => {
        const { userId } = requireContext(ctx);
        return { minors: await listOrphanedMinors(userId) };
      },
    }),
  },
});
