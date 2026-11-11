import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { coachRatingSummarySchema } from "@/lib/api/coach-ratings-schema";
import { getCoachRatingSummary } from "@/lib/coach-ratings.server";

/**
 * A coach's average rating and rating count (src/lib/coach-ratings.server.ts),
 * without the reviews. For anyone who finds the coach in the marketplace, as
 * `GET /api/v1/marketplace/coaches/{id}/ratings`.
 */
export const Route = createFileRoute("/api/v1/marketplace/coaches/$id_/ratings/summary")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/marketplace/coaches/{id}/ratings/summary",
      operationId: "getCoachRatingSummary",
      auth: "user",
      summary: "A coach's average rating",
      output: coachRatingSummarySchema,
      handler: async ({ ctx, params }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return getCoachRatingSummary(
          { userId, supabase, admin },
          z.string().uuid().parse(params.id),
        );
      },
    }),
  },
});
