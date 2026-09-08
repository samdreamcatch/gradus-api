import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { unlinkAthleteCompetition } from "@/lib/competition-results.server";

/**
 * Thin wrapper over the shared `unlinkAthleteCompetition` (PRD §7.10,
 * Appendix A). `{linkId}` is the competition id — the schema has no separate
 * surrogate link id; a link is keyed by (athlete_id, competition_id), the
 * same "id vs slug" accommodation as `recordAttendance`.
 */
export const Route = createFileRoute("/api/v1/athletes/$id/competition-links/$linkId")({
  server: {
    handlers: defineApiRoute({
      method: "DELETE",
      path: "/api/v1/athletes/{id}/competition-links/{linkId}",
      operationId: "unlinkAthleteCompetition",
      auth: "user",
      summary: "Unlink a rostered athlete from a competition",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { admin, userId } = requireContext(ctx);
        return unlinkAthleteCompetition(admin, userId, {
          athleteId: z.string().uuid().parse(params.id),
          competitionId: z.string().uuid().parse(params.linkId),
        });
      },
    }),
  },
});
