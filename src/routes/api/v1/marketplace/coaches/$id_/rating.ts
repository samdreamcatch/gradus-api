import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { coachRatingSchema } from "@/lib/api/coach-ratings-schema";
import { deleteMyCoachRating, rateCoach, rateCoachInput } from "@/lib/coach-ratings.server";

const coachId = (params: Record<string, string>) => z.string().uuid().parse(params.id);

/**
 * The caller's own rating of a coach (src/lib/coach-ratings.server.ts): `PUT`
 * rates them or changes the earlier rating, `DELETE` removes it. Only someone
 * who has worked with the coach may rate (403 otherwise).
 */
export const Route = createFileRoute("/api/v1/marketplace/coaches/$id_/rating")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "PUT",
        path: "/api/v1/marketplace/coaches/{id}/rating",
        operationId: "rateCoach",
        auth: "user",
        summary: "Rate a coach, or change your rating",
        input: rateCoachInput,
        output: coachRatingSchema,
        handler: async ({ ctx, input, params }) => {
          const { userId, supabase, admin } = requireContext(ctx);
          return rateCoach({ userId, supabase, admin }, coachId(params), input);
        },
      }),
      ...defineApiRoute({
        method: "DELETE",
        path: "/api/v1/marketplace/coaches/{id}/rating",
        operationId: "deleteCoachRating",
        auth: "user",
        summary: "Remove your rating of a coach",
        output: okSchema,
        handler: async ({ ctx, params }) => {
          const { userId, supabase, admin } = requireContext(ctx);
          return deleteMyCoachRating({ userId, supabase, admin }, coachId(params));
        },
      }),
    },
  },
});
