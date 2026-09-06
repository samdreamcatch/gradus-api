import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { requirePlansCoach } from "@/lib/plan-detail.server";
import { reorderPlanMoves, reorderPlanMovesInput } from "@/lib/plans.server";

/** Thin wrapper over the shared `reorderPlanMoves`: the full new order of a plan's moves. */
export const Route = createFileRoute("/api/v1/plans/$id/moves/order")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/plans/{id}/moves/order",
      operationId: "reorderPlanMoves",
      auth: "user",
      summary: "Reorder a plan's moves",
      input: reorderPlanMovesInput,
      output: okSchema,
      handler: async ({ ctx, input, params }) => {
        const coach = await requirePlansCoach(requireContext(ctx));
        return reorderPlanMoves(coach, z.string().uuid().parse(params.id), input.orderedIds);
      },
    }),
  },
});
