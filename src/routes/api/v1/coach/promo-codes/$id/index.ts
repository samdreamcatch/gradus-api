import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { coachPromoCodeSchema } from "@/lib/api/marketplace-schema";
import { okSchema } from "@/lib/api/onboarding-schema";
import {
  deleteCoachPromoCode,
  updateCoachPromoCode,
  updatePromoCodeInput,
} from "@/lib/coach-promo-codes.server";

const promoId = (params: Record<string, string>) => z.string().uuid().parse(params.id);

/**
 * Thin wrappers over `updateCoachPromoCode` and `deleteCoachPromoCode`: change
 * any of a promo code's fields (pause it with `active: false`), or delete it.
 * Purchases that already applied it keep what they paid.
 */
export const Route = createFileRoute("/api/v1/coach/promo-codes/$id/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "PATCH",
        path: "/api/v1/coach/promo-codes/{id}",
        operationId: "updateCoachPromoCode",
        auth: "user",
        summary: "Change or pause a promo code",
        input: updatePromoCodeInput,
        output: coachPromoCodeSchema,
        handler: async ({ ctx, input, params }) => {
          const { userId, admin } = requireContext(ctx);
          return updateCoachPromoCode({ userId, admin }, promoId(params), input);
        },
      }),
      ...defineApiRoute({
        method: "DELETE",
        path: "/api/v1/coach/promo-codes/{id}",
        operationId: "deleteCoachPromoCode",
        auth: "user",
        summary: "Delete a promo code",
        output: okSchema,
        handler: async ({ ctx, params }) => {
          const { userId, admin } = requireContext(ctx);
          return deleteCoachPromoCode({ userId, admin }, promoId(params));
        },
      }),
    },
  },
});
