import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { planRatingSummarySchema } from "@/lib/api/plan-ratings-schema";
import { getPlanRatingSummary } from "@/lib/plan-ratings.server";

/**
 * A plan's average rating and rating count (src/lib/plan-ratings.server.ts),
 * without the reviews. For anyone who can see the plan or finds it in the
 * marketplace, as `GET /api/v1/plans/{id}/ratings`.
 */
export const Route = createFileRoute("/api/v1/plans/$id/ratings/summary")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/plans/{id}/ratings/summary",
      operationId: "getPlanRatingSummary",
      auth: "user",
      summary: "A plan's average rating",
      output: planRatingSummarySchema,
      handler: async ({ ctx, params }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return getPlanRatingSummary(
          { userId, supabase, admin },
          z.string().uuid().parse(params.id),
        );
      },
    }),
  },
});
