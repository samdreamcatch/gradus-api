import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { coachRatingSchema } from "@/lib/api/coach-ratings-schema";
import { respondToCoachRating, respondToCoachRatingInput } from "@/lib/coach-ratings.server";

/**
 * The coach's reply to one rating of them (src/lib/coach-ratings.server.ts);
 * `response: null` removes it. Only that coach (403 otherwise).
 */
export const Route = createFileRoute("/api/v1/marketplace/coaches/$id_/ratings/$ratingId/response")(
  {
    server: {
      handlers: defineApiRoute({
        method: "PUT",
        path: "/api/v1/marketplace/coaches/{id}/ratings/{ratingId}/response",
        operationId: "respondToCoachRating",
        auth: "user",
        summary: "Reply to a rating of you",
        input: respondToCoachRatingInput,
        output: coachRatingSchema,
        handler: async ({ ctx, input, params }) => {
          const { userId, supabase, admin } = requireContext(ctx);
          return respondToCoachRating(
            { userId, supabase, admin },
            z.string().uuid().parse(params.id),
            z.string().uuid().parse(params.ratingId),
            input,
          );
        },
      }),
    },
  },
);
