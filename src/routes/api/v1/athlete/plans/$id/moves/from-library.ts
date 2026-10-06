import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { insertedSchema } from "@/lib/api/plans-schema";
import {
  addAthleteLibraryMovesInput,
  addSeedMovesToAuthoredPlan,
} from "@/lib/athlete-authoring.server";

/** Thin wrapper over the shared `addSeedMovesToAuthoredPlan`: append curriculum moves, in the order given, as plain rows (the athlete has no personal library to link to). */
export const Route = createFileRoute("/api/v1/athlete/plans/$id/moves/from-library")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/athlete/plans/{id}/moves/from-library",
      operationId: "addAthleteLibraryMovesToPlan",
      auth: "user",
      idempotent: true,
      summary: "Add curriculum moves to a plan the athlete wrote",
      input: addAthleteLibraryMovesInput,
      output: insertedSchema,
      handler: async ({ ctx, input, params }) => {
        const { userId, supabase } = requireContext(ctx);
        return addSeedMovesToAuthoredPlan(
          { userId, supabase },
          z.string().uuid().parse(params.id),
          input.moveIds,
        );
      },
    }),
  },
});
