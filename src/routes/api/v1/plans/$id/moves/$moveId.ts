import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { requirePlansCoach } from "@/lib/plan-detail.server";
import { planMovePatch, removePlanMove, updatePlanMove } from "@/lib/plans.server";

const ids = (params: Record<string, string>) => ({
  planId: z.string().uuid().parse(params.id),
  moveId: z.string().uuid().parse(params.moveId),
});

/** Thin wrappers over the shared `updatePlanMove` and `removePlanMove`: one move inside a plan, by its plan-move id. */
export const Route = createFileRoute("/api/v1/plans/$id/moves/$moveId")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "PATCH",
        path: "/api/v1/plans/{id}/moves/{moveId}",
        operationId: "updatePlanMove",
        auth: "user",
        summary: "Edit a move inside a plan",
        input: planMovePatch,
        output: okSchema,
        handler: async ({ ctx, input, params }) => {
          const coach = await requirePlansCoach(requireContext(ctx));
          const { planId, moveId } = ids(params);
          return updatePlanMove(coach, moveId, input, planId);
        },
      }),
      ...defineApiRoute({
        method: "DELETE",
        path: "/api/v1/plans/{id}/moves/{moveId}",
        operationId: "removePlanMove",
        auth: "user",
        summary: "Remove a move from a plan",
        output: okSchema,
        handler: async ({ ctx, params }) => {
          const coach = await requirePlansCoach(requireContext(ctx));
          const { planId, moveId } = ids(params);
          return removePlanMove(coach, moveId, planId);
        },
      }),
    },
  },
});
