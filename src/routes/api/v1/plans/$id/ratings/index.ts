import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { planRatingsPageSchema } from "@/lib/api/plan-ratings-schema";
import { listPlanRatings, listPlanRatingsQuery } from "@/lib/plan-ratings.server";

/**
 * A plan's ratings, newest first, with its totals, the caller's own rating,
 * and whether they may rate it (src/lib/plan-ratings.server.ts). For anyone
 * who can see the plan or finds it in the marketplace.
 */
export const Route = createFileRoute("/api/v1/plans/$id/ratings/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/plans/{id}/ratings",
      operationId: "listPlanRatings",
      auth: "user",
      summary: "A plan's ratings and reviews",
      query: listPlanRatingsQuery,
      output: planRatingsPageSchema,
      handler: async ({ ctx, query, params }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return listPlanRatings(
          { userId, supabase, admin },
          z.string().uuid().parse(params.id),
          query,
        );
      },
    }),
  },
});
