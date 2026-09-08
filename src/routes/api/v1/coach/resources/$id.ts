import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { resourceIdParam } from "@/lib/api/resources-params";
import { deleteCoachResource } from "@/lib/coach-resources.server";

/** Thin wrapper over the shared `deleteCoachResource` (PRD §7.9, Appendix A "Resources and Ask Gradus"). */
export const Route = createFileRoute("/api/v1/coach/resources/$id")({
  server: {
    handlers: defineApiRoute({
      method: "DELETE",
      path: "/api/v1/coach/resources/{id}",
      operationId: "deleteCoachResource",
      auth: "user",
      summary: "Delete one of the coach's own uploaded resources",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { userId, supabase } = requireContext(ctx);
        return deleteCoachResource({ userId, supabase }, resourceIdParam(params));
      },
    }),
  },
});
