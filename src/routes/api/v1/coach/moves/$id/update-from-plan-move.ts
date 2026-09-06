import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { moveIdSchema } from "@/lib/api/plans-schema";
import { updateLibraryMoveFromPlanMove } from "@/lib/moves.server";
import { requirePlansCoach } from "@/lib/plan-detail.server";

/** Thin wrapper over the shared `updateLibraryMoveFromPlanMove`: push a plan move's edits onto the library move it links to. */
export const Route = createFileRoute("/api/v1/coach/moves/$id/update-from-plan-move")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/moves/{id}/update-from-plan-move",
      operationId: "updateLibraryMoveFromPlanMove",
      auth: "user",
      summary: "Update a library move from a plan move's fields",
      input: z.object({ planMoveId: z.string().uuid() }),
      output: moveIdSchema,
      handler: async ({ ctx, input, params }) =>
        updateLibraryMoveFromPlanMove(
          await requirePlansCoach(requireContext(ctx)),
          input.planMoveId,
          z.string().uuid().parse(params.id),
        ),
    }),
  },
});
