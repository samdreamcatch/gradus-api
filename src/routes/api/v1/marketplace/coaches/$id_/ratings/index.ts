import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { coachRatingsPageSchema } from "@/lib/api/coach-ratings-schema";
import { listCoachRatings, listCoachRatingsQuery } from "@/lib/coach-ratings.server";

/**
 * A coach's ratings, newest first, with their totals, the caller's own
 * rating, and whether they may rate (src/lib/coach-ratings.server.ts). For
 * anyone who finds the coach in the marketplace.
 */
export const Route = createFileRoute("/api/v1/marketplace/coaches/$id_/ratings/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/marketplace/coaches/{id}/ratings",
      operationId: "listCoachRatings",
      auth: "user",
      summary: "A coach's ratings and reviews",
      query: listCoachRatingsQuery,
      output: coachRatingsPageSchema,
      handler: async ({ ctx, query, params }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return listCoachRatings(
          { userId, supabase, admin },
          z.string().uuid().parse(params.id),
          query,
        );
      },
    }),
  },
});
