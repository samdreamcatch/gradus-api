import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { marketplaceCoachSchema } from "@/lib/api/marketplace-schema";
import { getMarketplaceCoach } from "@/lib/marketplace-plans.server";

/**
 * Thin wrapper over the shared `getMarketplaceCoach` in
 * `src/lib/marketplace-plans.server.ts`: a coach who sells plans (Coach Pro,
 * no club), their sports and levels, their rating across their plans, and
 * their listings as the caller sees them. Any other coach is 404.
 */
export const Route = createFileRoute("/api/v1/marketplace/coaches/$id")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/marketplace/coaches/{id}",
      operationId: "getMarketplaceCoach",
      auth: "user",
      summary: "A marketplace coach's profile and listings",
      output: marketplaceCoachSchema,
      handler: async ({ ctx, params }) => {
        const { userId, admin } = requireContext(ctx);
        return getMarketplaceCoach({ userId, admin }, z.string().uuid().parse(params.id));
      },
    }),
  },
});
