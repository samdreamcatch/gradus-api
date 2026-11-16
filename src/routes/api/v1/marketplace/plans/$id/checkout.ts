import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { planPurchaseSchema } from "@/lib/api/marketplace-schema";
import { startPlanCheckout, startPlanCheckoutInput } from "@/lib/plan-purchases.server";
import { publicOrigin } from "@/lib/api/public-origin";

/**
 * Thin wrapper over `startPlanCheckout` in `src/lib/plan-purchases.server.ts`:
 * starts buying a listing for an athlete (a parent names their child) and
 * returns the Stripe Checkout page for the app to open in Safari. A free plan
 * comes back already delivered, with no page. 403 when the caller may not
 * buy (`parent_required` for minors who need their parent), 409 when the
 * coach can't be paid yet (`seller_not_ready`) or it's already bought.
 */
export const Route = createFileRoute("/api/v1/marketplace/plans/$id/checkout")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/marketplace/plans/{id}/checkout",
      operationId: "startMarketplacePlanCheckout",
      auth: "user",
      summary: "Start buying a marketplace plan",
      input: startPlanCheckoutInput,
      output: z.object({ purchase: planPurchaseSchema, checkoutUrl: z.string().nullable() }),
      handler: async ({ ctx, input, params, request }) => {
        const { userId, admin } = requireContext(ctx);
        return startPlanCheckout({ userId, admin }, z.string().uuid().parse(params.id), input, {
          origin: publicOrigin(request),
        });
      },
    }),
  },
});
