import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { createStripeConnectDashboardLink } from "@/lib/stripe-connect.server";

/**
 * Thin wrapper over `createStripeConnectDashboardLink` in
 * `src/lib/stripe-connect.server.ts`: a one-time link into the coach's Stripe
 * Express dashboard (balance, payouts, bank details). 409 until they've
 * finished connecting.
 */
export const Route = createFileRoute("/api/v1/coach/stripe-connect/dashboard")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/stripe-connect/dashboard",
      operationId: "createStripeConnectDashboardLink",
      auth: "user",
      summary: "Open the coach's Stripe dashboard",
      output: z.object({ url: z.string() }),
      handler: async ({ ctx }) => {
        const { userId, admin } = requireContext(ctx);
        return createStripeConnectDashboardLink({ userId, admin });
      },
    }),
  },
});
