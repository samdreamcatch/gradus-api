import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { skaterMatchSchema } from "@/lib/api/competition-results-schema";
import { athleteIdInput, listSkaterMatches } from "@/lib/competition-results.server";

/** Thin wrapper over the shared `listSkaterMatches` (PRD §7.10, Appendix A). */
export const Route = createFileRoute("/api/v1/competitions/$id/skater-matches")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/competitions/{id}/skater-matches",
      operationId: "listSkaterMatches",
      auth: "user",
      summary: "Likely skater matches for a rostered athlete in a finished competition",
      input: athleteIdInput,
      output: z.array(skaterMatchSchema),
      handler: async ({ ctx, input, params }) => {
        const { admin, userId } = requireContext(ctx);
        return listSkaterMatches(admin, userId, {
          athleteId: input.athleteId,
          competitionId: z.string().uuid().parse(params.id),
        });
      },
    }),
  },
});
