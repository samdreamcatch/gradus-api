import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { athleteCompetitionLinkSchema } from "@/lib/api/competition-results-schema";
import { getAthleteCompetitionResults } from "@/lib/competition-results.server";

/** Thin wrapper over the shared `getAthleteCompetitionResults` (PRD §7.10, Appendix A). */
export const Route = createFileRoute("/api/v1/athletes/$id/competition-results/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/athletes/{id}/competition-results",
      operationId: "getAthleteCompetitionResults",
      auth: "user",
      summary: "An athlete's linked competitions and stored results, as stacked folders",
      output: z.array(athleteCompetitionLinkSchema),
      handler: async ({ ctx, params }) => {
        const { admin, userId } = requireContext(ctx);
        return getAthleteCompetitionResults(admin, userId, {
          athleteId: z.string().uuid().parse(params.id),
        });
      },
    }),
  },
});
