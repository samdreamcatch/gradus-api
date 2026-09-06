import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { libraryLinkResultSchema } from "@/lib/api/plans-schema";
import { forkPlanMoveToLibrary, forkPlanMoveToLibraryInput } from "@/lib/moves.server";
import { requirePlansCoach } from "@/lib/plan-detail.server";

/** Thin wrapper over the shared `forkPlanMoveToLibrary`: a plan move's edits become a new library move, optionally renamed. */
export const Route = createFileRoute("/api/v1/coach/moves/fork-from-plan-move")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/moves/fork-from-plan-move",
      operationId: "forkPlanMoveToLibrary",
      auth: "user",
      summary: "Fork a plan move into a new library move",
      input: forkPlanMoveToLibraryInput,
      output: libraryLinkResultSchema,
      handler: async ({ ctx, input }) =>
        forkPlanMoveToLibrary(await requirePlansCoach(requireContext(ctx)), input),
    }),
  },
});
