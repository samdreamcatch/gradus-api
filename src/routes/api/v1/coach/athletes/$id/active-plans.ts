import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { activePlansSchema } from "@/lib/api/plans-schema";
import { requirePlansCoach } from "@/lib/plan-detail.server";
import { getAthleteActivePlans } from "@/lib/plans.server";

/** Thin wrapper over the shared `getAthleteActivePlans`: what the bench-choice sheet lists when activation hits the cap. */
export const Route = createFileRoute("/api/v1/coach/athletes/$id/active-plans")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/athletes/{id}/active-plans",
      operationId: "getAthleteActivePlans",
      auth: "user",
      summary: "An athlete's active plans from this coach",
      query: z.object({ excludePlanId: z.string().uuid().optional() }),
      output: activePlansSchema,
      handler: async ({ ctx, query, params }) => {
        const coach = await requirePlansCoach(requireContext(ctx));
        return {
          plans: await getAthleteActivePlans(
            coach,
            z.string().uuid().parse(params.id),
            query.excludePlanId,
          ),
        };
      },
    }),
  },
});
