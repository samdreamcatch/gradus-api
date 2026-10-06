import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { reorderAthleteMovesInput, reorderAuthoredPlanMoves } from "@/lib/athlete-authoring.server";

/** Thin wrapper over the shared `reorderAuthoredPlanMoves`: the full new order of a plan's moves. */
export const Route = createFileRoute("/api/v1/athlete/plans/$id/moves/order")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/athlete/plans/{id}/moves/order",
      operationId: "reorderAthletePlanMoves",
      auth: "user",
      summary: "Reorder the moves of a plan the athlete wrote",
      input: reorderAthleteMovesInput,
      output: okSchema,
      handler: async ({ ctx, input, params }) => {
        const { userId, supabase } = requireContext(ctx);
        return reorderAuthoredPlanMoves(
          { userId, supabase },
          z.string().uuid().parse(params.id),
          input.orderedIds,
        );
      },
    }),
  },
});
