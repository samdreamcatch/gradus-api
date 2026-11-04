import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { planRatingSchema } from "@/lib/api/plan-ratings-schema";
import { deleteMyPlanRating, ratePlan, ratePlanInput } from "@/lib/plan-ratings.server";

const planId = (params: Record<string, string>) => z.string().uuid().parse(params.id);

/**
 * The caller's own rating of a plan (src/lib/plan-ratings.server.ts): `PUT`
 * rates it or changes the earlier rating, `DELETE` removes it. Only the plan's
 * athlete and their parents may rate (403 otherwise).
 */
export const Route = createFileRoute("/api/v1/plans/$id/rating")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "PUT",
        path: "/api/v1/plans/{id}/rating",
        operationId: "ratePlan",
        auth: "user",
        summary: "Rate a plan, or change your rating",
        input: ratePlanInput,
        output: planRatingSchema,
        handler: async ({ ctx, input, params }) => {
          const { userId, supabase, admin } = requireContext(ctx);
          return ratePlan({ userId, supabase, admin }, planId(params), input);
        },
      }),
      ...defineApiRoute({
        method: "DELETE",
        path: "/api/v1/plans/{id}/rating",
        operationId: "deletePlanRating",
        auth: "user",
        summary: "Remove your rating of a plan",
        output: okSchema,
        handler: async ({ ctx, params }) => {
          const { userId, supabase, admin } = requireContext(ctx);
          return deleteMyPlanRating({ userId, supabase, admin }, planId(params));
        },
      }),
    },
  },
});
