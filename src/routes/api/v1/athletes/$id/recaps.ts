import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { competitionRecapSchema } from "@/lib/api/competition-recap-schema";
import { getAthleteCompetitionRecaps } from "@/lib/competition-recap.server";

/** Thin wrapper over the shared `getAthleteCompetitionRecaps` (PRD §7.10, Appendix A). */
export const Route = createFileRoute("/api/v1/athletes/$id/recaps")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/athletes/{id}/recaps",
      operationId: "getAthleteCompetitionRecaps",
      auth: "user",
      summary: "An athlete's competition recaps — their circle only",
      output: z.array(competitionRecapSchema),
      handler: async ({ ctx, params }) => {
        const { admin, userId } = requireContext(ctx);
        return getAthleteCompetitionRecaps(admin, userId, {
          athleteId: z.string().uuid().parse(params.id),
        });
      },
    }),
  },
});
