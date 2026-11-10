import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { planPurchaseSchema } from "@/lib/api/marketplace-schema";
import { getPlanPurchase } from "@/lib/plan-purchases.server";

/**
 * Thin wrapper over `getPlanPurchase` in `src/lib/plan-purchases.server.ts`:
 * the caller's purchase. The app asks on its return from Stripe; a paid
 * checkout not recorded yet is recorded first, so this works even before the
 * webhook arrives.
 */
export const Route = createFileRoute("/api/v1/marketplace/purchases/$id/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/marketplace/purchases/{id}",
      operationId: "getMarketplacePurchase",
      auth: "user",
      summary: "A plan purchase's status",
      output: planPurchaseSchema,
      handler: async ({ ctx, params }) => {
        const { userId, admin } = requireContext(ctx);
        return getPlanPurchase({ userId, admin }, z.string().uuid().parse(params.id));
      },
    }),
  },
});
