import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { pendingRecapSchema } from "@/lib/api/competition-recap-schema";
import { getPendingCompetitionRecap } from "@/lib/competition-recap.server";

/** Thin wrapper over the shared `getPendingCompetitionRecap` (PRD §7.10, Appendix A). */
export const Route = createFileRoute("/api/v1/recaps/pending")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/recaps/pending",
      operationId: "getPendingCompetitionRecap",
      auth: "user",
      summary: "A finished competition the caller was just at, awaiting a recap",
      output: pendingRecapSchema.nullable(),
      handler: async ({ ctx }) => {
        const { admin, userId } = requireContext(ctx);
        return getPendingCompetitionRecap(admin, userId);
      },
    }),
  },
});
