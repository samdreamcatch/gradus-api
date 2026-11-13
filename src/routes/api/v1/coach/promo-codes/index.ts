import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { coachPromoCodeSchema, coachPromoCodesSchema } from "@/lib/api/marketplace-schema";
import {
  createCoachPromoCode,
  createPromoCodeInput,
  listCoachPromoCodes,
} from "@/lib/coach-promo-codes.server";

/**
 * Thin wrappers over `listCoachPromoCodes` and `createCoachPromoCode` in
 * `src/lib/coach-promo-codes.server.ts`: the coach's promo codes for their
 * marketplace plans, with their uses and revenue, and making a new one. 409
 * `promo_code_taken` when the coach already has the code.
 */
export const Route = createFileRoute("/api/v1/coach/promo-codes/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/coach/promo-codes",
        operationId: "listCoachPromoCodes",
        auth: "user",
        summary: "The coach's promo codes, newest first",
        output: coachPromoCodesSchema,
        handler: async ({ ctx }) => {
          const { userId, admin } = requireContext(ctx);
          return listCoachPromoCodes({ userId, admin });
        },
      }),
      ...defineApiRoute({
        method: "POST",
        path: "/api/v1/coach/promo-codes",
        operationId: "createCoachPromoCode",
        auth: "user",
        summary: "Make a promo code for the coach's marketplace plans",
        input: createPromoCodeInput,
        output: coachPromoCodeSchema,
        handler: async ({ ctx, input }) => {
          const { userId, admin } = requireContext(ctx);
          return createCoachPromoCode({ userId, admin }, input);
        },
      }),
    },
  },
});
