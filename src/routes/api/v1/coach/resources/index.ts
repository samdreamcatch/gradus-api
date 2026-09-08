import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { resourceIdResultSchema } from "@/lib/api/resources-schema";
import { createCoachResource, createCoachResourceInput } from "@/lib/coach-resources.server";

/**
 * Thin wrapper over the shared `createCoachResource`
 * (PRD §7.9, Appendix A "Resources and Ask Gradus"). `[idem]`: a retried
 * create never inserts the same resource twice.
 */
export const Route = createFileRoute("/api/v1/coach/resources/")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/resources",
      operationId: "createCoachResource",
      auth: "user",
      idempotent: true,
      summary: "Upload or link a resource for the coach's own athletes",
      input: createCoachResourceInput,
      output: resourceIdResultSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase } = requireContext(ctx);
        return createCoachResource({ userId, supabase }, input);
      },
    }),
  },
});
