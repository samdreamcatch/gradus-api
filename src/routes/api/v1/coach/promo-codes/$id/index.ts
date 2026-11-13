import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { coachPromoCodeSchema } from "@/lib/api/marketplace-schema";
import { okSchema } from "@/lib/api/onboarding-schema";
import {
  deleteCoachPromoCode,
  getCoachPromoCode,
  updateCoachPromoCode,
  updatePromoCodeInput,
} from "@/lib/coach-promo-codes.server";

const promoId = (params: Record<string, string>) => z.string().uuid().parse(params.id);

/**
 * Thin wrappers over `getCoachPromoCode`, `updateCoachPromoCode` and
 * `deleteCoachPromoCode`: one promo code with its uses and revenue, changing
 * it (disable with `active: false`), or deleting it. Purchases that already
 * applied it keep what they paid.
 */
export const Route = createFileRoute("/api/v1/coach/promo-codes/$id/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/coach/promo-codes/{id}",
        operationId: "getCoachPromoCode",
        auth: "user",
        summary: "One promo code, with its uses and revenue",
        output: coachPromoCodeSchema,
        handler: async ({ ctx, params }) => {
          const { userId, admin } = requireContext(ctx);
          return getCoachPromoCode({ userId, admin }, promoId(params));
        },
      }),
      ...defineApiRoute({
        method: "PATCH",
        path: "/api/v1/coach/promo-codes/{id}",
        operationId: "updateCoachPromoCode",
        auth: "user",
        summary: "Change or disable a promo code",
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
