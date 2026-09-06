import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { archiveMove } from "@/lib/moves.server";
import { requirePlansCoach } from "@/lib/plan-detail.server";

/** Thin wrapper over the shared `archiveMove`: hides a move from the library; plans that use it keep their copy. */
export const Route = createFileRoute("/api/v1/coach/moves/$id/archive")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/moves/{id}/archive",
      operationId: "archiveMove",
      auth: "user",
      summary: "Archive a library move",
      output: okSchema,
      handler: async ({ ctx, params }) =>
        archiveMove(await requirePlansCoach(requireContext(ctx)), z.string().uuid().parse(params.id)),
    }),
  },
});
