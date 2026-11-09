import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import {
  startStripeConnectOnboarding,
  stripeConnectOnboardingInput,
} from "@/lib/stripe-connect.server";

/**
 * Thin wrapper over `startStripeConnectOnboarding` in
 * `src/lib/stripe-connect.server.ts`: creates the coach's Express account the
 * first time, and returns a Stripe-hosted onboarding link to open.
 */
export const Route = createFileRoute("/api/v1/coach/stripe-connect/onboarding")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/stripe-connect/onboarding",
      operationId: "startStripeConnectOnboarding",
      auth: "user",
      summary: "Start (or continue) connecting the coach's Stripe account",
      input: stripeConnectOnboardingInput,
      output: z.object({ url: z.string() }),
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return startStripeConnectOnboarding({ userId, admin }, input);
      },
    }),
  },
});
