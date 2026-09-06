import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { promoValidationSchema } from "@/lib/api/onboarding-schema";
import { promoCodeSchema, validatePromoCode } from "@/lib/promo.server";

const inputSchema = z.object({ code: promoCodeSchema });

/** Thin wrapper over the shared `validatePromoCode`: what a code is worth before it is applied. */
export const Route = createFileRoute("/api/v1/promo-codes/validate")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/promo-codes/validate",
      auth: "user",
      summary: "Check a promo code",
      input: inputSchema,
      output: promoValidationSchema,
      handler: async ({ ctx, input }) => {
        const { supabase } = requireContext(ctx);
        return validatePromoCode({ supabase }, input.code);
      },
    }),
  },
});
