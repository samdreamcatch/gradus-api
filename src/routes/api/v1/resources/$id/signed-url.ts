import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { resourceIdParam } from "@/lib/api/resources-params";
import { signedUrlSchema } from "@/lib/api/resources-schema";
import { getResourceSignedUrl } from "@/lib/parent-resources.server";

/**
 * Thin wrapper over the shared `getResourceSignedUrl`
 * (PRD §7.9, Appendix A "Resources and Ask Gradus"): the path param `id`
 * replaces the web server function's body `resourceId` field.
 */
export const Route = createFileRoute("/api/v1/resources/$id/signed-url")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/resources/{id}/signed-url",
      operationId: "getResourceSignedUrl",
      auth: "user",
      summary: "A signed URL (or the link URL) for one resource",
      output: signedUrlSchema,
      handler: async ({ ctx, params }) => {
        const { userId, supabase } = requireContext(ctx);
        return getResourceSignedUrl({ userId, supabase }, resourceIdParam(params));
      },
    }),
  },
});
