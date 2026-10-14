import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { assertAiConsent } from "@/lib/ai-consent.server";
import { generatedPlanResultSchema } from "@/lib/api/competition-results-schema";
import { generatePlanFromResults } from "@/lib/competition-results.server";

/**
 * Thin wrapper over the shared `generatePlanFromResults` (PRD §7.10,
 * Appendix A). `{resultId}` is the competition id — a coach drafts a plan
 * from an athlete's whole "stacked folder" of results for one competition,
 * never a single event row (same id-naming accommodation as
 * `competition-links/{linkId}`).
 */
export const Route = createFileRoute(
  "/api/v1/athletes/$id/competition-results/$resultId/generate-plan",
)({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/athletes/{id}/competition-results/{resultId}/generate-plan",
      operationId: "generatePlanFromResults",
      auth: "user",
      summary: "Draft a practice plan from an athlete's judged competition protocol",
      output: generatedPlanResultSchema,
      handler: async ({ ctx, params }) => {
        const { admin, userId } = requireContext(ctx);
        await assertAiConsent(admin, userId);
        return generatePlanFromResults(admin, userId, {
          athleteId: z.string().uuid().parse(params.id),
          competitionId: z.string().uuid().parse(params.resultId),
        });
      },
    }),
  },
});
