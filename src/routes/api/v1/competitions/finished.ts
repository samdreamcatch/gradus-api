import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { finishedCompetitionSchema } from "@/lib/api/competition-results-schema";
import { athleteIdInput, listFinishedCompetitions } from "@/lib/competition-results.server";

/** Thin wrapper over the shared `listFinishedCompetitions` (PRD §7.10, Appendix A). */
export const Route = createFileRoute("/api/v1/competitions/finished")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/competitions/finished",
      operationId: "listFinishedCompetitions",
      auth: "user",
      summary: "Finished competitions a coach can link a rostered athlete to",
      query: athleteIdInput,
      output: z.array(finishedCompetitionSchema),
      handler: async ({ ctx, query }) => {
        const { admin, userId } = requireContext(ctx);
        return listFinishedCompetitions(admin, userId, query);
      },
    }),
  },
});
