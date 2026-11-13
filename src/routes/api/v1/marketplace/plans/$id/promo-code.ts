import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { planPromoPreviewSchema } from "@/lib/api/marketplace-schema";
import { applyPromoCodeInput } from "@/lib/coach-promo-codes.server";
import { previewPlanPromoCode } from "@/lib/plan-purchases.server";

/**
 * Thin wrapper over `previewPlanPromoCode` in `src/lib/plan-purchases.server.ts`:
 * whether one of the coach's promo codes works on this listing for the
 * caller, and the price with it, before they buy. A code that doesn't work
 * comes back as a `state` (invalid, expired, exhausted, wrong_plan,
 * already_used, below_minimum) with a `message`, not an error. Nothing is
 * saved; pass the code as `promoCode` to checkout.
 */
export const Route = createFileRoute("/api/v1/marketplace/plans/$id/promo-code")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/marketplace/plans/{id}/promo-code",
      operationId: "previewMarketplacePlanPromoCode",
      auth: "user",
      summary: "Check a promo code on a marketplace plan and show the price with it",
      input: applyPromoCodeInput,
      output: planPromoPreviewSchema,
      handler: async ({ ctx, input, params }) => {
        const { userId, admin } = requireContext(ctx);
        return previewPlanPromoCode({ userId, admin }, z.string().uuid().parse(params.id), input);
      },
    }),
  },
});
