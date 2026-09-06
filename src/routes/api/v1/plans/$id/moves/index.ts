import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { addMoveResultSchema } from "@/lib/api/plans-schema";
import { requirePlansCoach } from "@/lib/plan-detail.server";
import { addMoveToPlan } from "@/lib/plans.server";

/** Thin wrapper over the shared `addMoveToPlan`: append one library move to the end of a plan. */
export const Route = createFileRoute("/api/v1/plans/$id/moves/")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/plans/{id}/moves",
      operationId: "addPlanMove",
      auth: "user",
      summary: "Add a library move to a plan",
      input: z.object({ moveId: z.string().uuid() }),
      output: addMoveResultSchema,
      handler: async ({ ctx, input, params }) => {
        const coach = await requirePlansCoach(requireContext(ctx));
        return addMoveToPlan(coach, z.string().uuid().parse(params.id), input.moveId);
      },
    }),
  },
});
