import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { coachRosterCandidateSchema } from "@/lib/api/competition-results-schema";
import { listCoachRosterForCompetition } from "@/lib/competition-results.server";

/** Thin wrapper over the shared `listCoachRosterForCompetition` (PRD §7.10, Appendix A). */
export const Route = createFileRoute("/api/v1/coach/competitions/$id/roster")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/competitions/{id}/roster",
      operationId: "listCoachRosterForCompetition",
      auth: "user",
      summary: "Rostered figure-skating athletes the coach can link at this competition",
      output: z.array(coachRosterCandidateSchema),
      handler: async ({ ctx, params }) => {
        const { admin, userId } = requireContext(ctx);
        return listCoachRosterForCompetition(admin, userId, {
          competitionId: z.string().uuid().parse(params.id),
        });
      },
    }),
  },
});
