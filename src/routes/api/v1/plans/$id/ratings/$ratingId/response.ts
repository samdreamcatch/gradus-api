import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { planRatingSchema } from "@/lib/api/plan-ratings-schema";
import { respondToPlanRating, respondToRatingInput } from "@/lib/plan-ratings.server";

/**
 * The plan coach's reply to one rating (src/lib/plan-ratings.server.ts);
 * `response: null` removes it. Only the plan's coach (403 otherwise).
 */
export const Route = createFileRoute("/api/v1/plans/$id/ratings/$ratingId/response")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/plans/{id}/ratings/{ratingId}/response",
      operationId: "respondToPlanRating",
      auth: "user",
      summary: "Reply to a rating of your plan",
      input: respondToRatingInput,
      output: planRatingSchema,
      handler: async ({ ctx, input, params }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return respondToPlanRating(
          { userId, supabase, admin },
          z.string().uuid().parse(params.id),
          z.string().uuid().parse(params.ratingId),
          input,
        );
      },
    }),
  },
});
