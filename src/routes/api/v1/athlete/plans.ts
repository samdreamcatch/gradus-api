import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { defineApiRoute, weakETag } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { athletePlansSchema } from "@/lib/api/plans-schema";
import { listAthletePlans } from "@/lib/athlete-plans.server";

/**
 * Thin wrapper over the shared `listAthletePlans` (PRD §7.8, Appendix A
 * `[etag]`): the signed-in athlete's active and benched plans, seeding the
 * Gradus starter programs on first read.
 */
export const Route = createFileRoute("/api/v1/athlete/plans")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/athlete/plans",
      operationId: "listAthletePlans",
      auth: "user",
      summary: "The athlete's own plans",
      output: athletePlansSchema,
      etag: (body) =>
        weakETag([
          "athlete-plans",
          createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16),
        ]),
      handler: async ({ ctx }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return listAthletePlans({ userId, supabase, admin });
      },
    }),
  },
});
