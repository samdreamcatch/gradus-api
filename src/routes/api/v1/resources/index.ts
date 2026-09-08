import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { roleAwareResourcesSchema } from "@/lib/api/resources-schema";
import { getResourcesForCaller } from "@/lib/resources.server";

/**
 * Thin wrapper over the shared `getResourcesForCaller` (PRD §7.9, Appendix A
 * "Resources and Ask Gradus" — listed once as "role-aware" rather than as
 * three separate endpoints): dispatches to the coach, parent, or athlete
 * resource feed based on the caller's role.
 */
export const Route = createFileRoute("/api/v1/resources/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/resources",
      operationId: "getResources",
      auth: "user",
      summary: "The caller's resource feed (coach, parent, or athlete)",
      output: roleAwareResourcesSchema,
      handler: async ({ ctx }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return getResourcesForCaller({ userId, supabase, admin });
      },
    }),
  },
});
