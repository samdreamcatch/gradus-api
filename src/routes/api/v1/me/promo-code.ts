import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { promoAppliedSchema } from "@/lib/api/onboarding-schema";
import { applyPromoCodeToMyProfile, promoCodeSchema } from "@/lib/promo.server";

const inputSchema = z.object({ code: promoCodeSchema.optional() });

/**
 * Thin wrapper over the shared `applyPromoCodeToMyProfile` (PRD §7.1
 * "Coach sign-up": the promo code from the sign-up form or an invite
 * link). First code wins; an unknown or inactive code applies nothing.
 */
export const Route = createFileRoute("/api/v1/me/promo-code")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/me/promo-code",
      auth: "user",
      summary: "Apply a promo code to the caller's profile",
      input: inputSchema,
      output: promoAppliedSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return applyPromoCodeToMyProfile({ userId, supabase, admin }, input.code);
      },
    }),
  },
});
