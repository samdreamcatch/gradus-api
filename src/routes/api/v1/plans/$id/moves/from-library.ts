import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { insertedSchema } from "@/lib/api/plans-schema";
import { requirePlansCoach } from "@/lib/plan-detail.server";
import { addLibraryMovesInput, addLibraryMovesToPlan } from "@/lib/plans.server";

/** Thin wrapper over the shared `addLibraryMovesToPlan`: append several library moves, in the order given. */
export const Route = createFileRoute("/api/v1/plans/$id/moves/from-library")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/plans/{id}/moves/from-library",
      operationId: "addLibraryMovesToPlan",
      auth: "user",
      summary: "Add several library moves to a plan",
      input: addLibraryMovesInput,
      output: insertedSchema,
      handler: async ({ ctx, input, params }) => {
        const coach = await requirePlansCoach(requireContext(ctx));
        return addLibraryMovesToPlan(coach, z.string().uuid().parse(params.id), input.moveIds);
      },
    }),
  },
});
