import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import {
  athleteMovePatch,
  removeAuthoredPlanMove,
  updateAuthoredPlanMove,
} from "@/lib/athlete-authoring.server";

const ids = (params: Record<string, string>) => ({
  planId: z.string().uuid().parse(params.id),
  moveId: z.string().uuid().parse(params.moveId),
});

/** Thin wrappers over the shared `updateAuthoredPlanMove` and `removeAuthoredPlanMove`: one move inside a plan the athlete wrote, by its plan-move id. */
export const Route = createFileRoute("/api/v1/athlete/plans/$id/moves/$moveId")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "PATCH",
        path: "/api/v1/athlete/plans/{id}/moves/{moveId}",
        operationId: "updateAthletePlanMove",
        auth: "user",
        summary: "Edit a move inside a plan the athlete wrote",
        input: athleteMovePatch,
        output: okSchema,
        handler: async ({ ctx, input, params }) => {
          const { userId, supabase } = requireContext(ctx);
          const { planId, moveId } = ids(params);
          return updateAuthoredPlanMove({ userId, supabase }, planId, moveId, input);
        },
      }),
      ...defineApiRoute({
        method: "DELETE",
        path: "/api/v1/athlete/plans/{id}/moves/{moveId}",
        operationId: "removeAthletePlanMove",
        auth: "user",
        summary: "Remove a move from a plan the athlete wrote",
        output: okSchema,
        handler: async ({ ctx, params }) => {
          const { userId, supabase } = requireContext(ctx);
          const { planId, moveId } = ids(params);
          return removeAuthoredPlanMove({ userId, supabase }, planId, moveId);
        },
      }),
    },
  },
});
