import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { planPromoPreviewSchema } from "@/lib/api/marketplace-schema";
import { applyPromoCodeInput } from "@/lib/coach-promo-codes.server";
import { previewPlanPromoCode } from "@/lib/plan-purchases.server";

/**
 * Thin wrapper over `previewPlanPromoCode` in `src/lib/plan-purchases.server.ts`:
 * what one of the coach's promo codes takes off this listing for the caller,
 * before they buy. Nothing is saved; pass the code as `promoCode` to checkout.
 * 404 `promo_code_invalid`; 422 `promo_code_expired`, `promo_code_not_applicable`,
 * `promo_code_used_up`, `promo_code_already_used`, `promo_code_below_minimum`.
 */
export const Route = createFileRoute("/api/v1/marketplace/plans/$id/promo-code")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/marketplace/plans/{id}/promo-code",
      operationId: "previewMarketplacePlanPromoCode",
      auth: "user",
      summary: "Check a promo code on a marketplace plan and show the discounted price",
      input: applyPromoCodeInput,
      output: planPromoPreviewSchema,
      handler: async ({ ctx, input, params }) => {
        const { userId, admin } = requireContext(ctx);
        return previewPlanPromoCode({ userId, admin }, z.string().uuid().parse(params.id), input);
      },
    }),
  },
});
