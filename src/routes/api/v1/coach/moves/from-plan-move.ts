import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { libraryLinkResultSchema } from "@/lib/api/plans-schema";
import { addPlanMoveToLibrary, addPlanMoveToLibraryInput } from "@/lib/moves.server";
import { requirePlansCoach } from "@/lib/plan-detail.server";

/** Thin wrapper over the shared `addPlanMoveToLibrary`: save a plan-only move into the library and link it. */
export const Route = createFileRoute("/api/v1/coach/moves/from-plan-move")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/moves/from-plan-move",
      operationId: "addPlanMoveToLibrary",
      auth: "user",
      summary: "Save a plan move into the library",
      input: addPlanMoveToLibraryInput,
      output: libraryLinkResultSchema,
      handler: async ({ ctx, input }) =>
        addPlanMoveToLibrary(await requirePlansCoach(requireContext(ctx)), input),
    }),
  },
});
