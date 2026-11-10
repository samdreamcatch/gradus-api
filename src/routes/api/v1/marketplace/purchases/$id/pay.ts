import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { planPurchaseSchema } from "@/lib/api/marketplace-schema";
import { payPlanPurchase } from "@/lib/plan-purchases.server";

/**
 * Thin wrapper over `payPlanPurchase` in `src/lib/plan-purchases.server.ts`:
 * "Complete payment" on a plan bought before its coach was on Stripe. Returns
 * the Stripe Checkout page to open; `checkoutUrl` is null when an earlier
 * checkout turned out to be paid already. 409 `coach_not_ready` while the
 * coach still isn't on Stripe, `already_paid` once it's paid.
 */
export const Route = createFileRoute("/api/v1/marketplace/purchases/$id/pay")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/marketplace/purchases/{id}/pay",
      operationId: "payMarketplacePurchase",
      auth: "user",
      summary: "Complete payment for a plan bought before the coach was on Stripe",
      output: z.object({ purchase: planPurchaseSchema, checkoutUrl: z.string().nullable() }),
      handler: async ({ ctx, params, request }) => {
        const { userId, admin } = requireContext(ctx);
        return payPlanPurchase({ userId, admin }, z.string().uuid().parse(params.id), {
          origin: new URL(request.url).origin,
        });
      },
    }),
  },
});
