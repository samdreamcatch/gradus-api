import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { defineApiRoute, weakETag } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { parentPlansQuery, parentPlansSchema } from "@/lib/api/plans-schema";
import { listParentPlans } from "@/lib/parent-plans.server";

/**
 * Thin wrapper over the shared `listParentPlans` (PRD §7.7, Appendix A
 * `[etag]`): every active or benched plan for the athletes this parent can
 * access, with the athlete options for the filter bar. The optional filters
 * narrow the same list the web filters client-side.
 */
export const Route = createFileRoute("/api/v1/parent/plans")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/parent/plans",
      operationId: "listParentPlans",
      auth: "user",
      summary: "Plans for the parent's athletes",
      query: parentPlansQuery,
      output: parentPlansSchema,
      etag: (body) =>
        weakETag([
          "parent-plans",
          createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16),
        ]),
      handler: async ({ ctx, query }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        const result = await listParentPlans({ userId, supabase, admin, includeAuthored: true });
        const plans = result.plans.filter(
          (p) =>
            (!query.status || p.status === query.status) &&
            (!query.coachId || p.coachId === query.coachId) &&
            (!query.athleteId || p.athleteId === query.athleteId),
        );
        return { athletes: result.athletes, plans };
      },
    }),
  },
});
