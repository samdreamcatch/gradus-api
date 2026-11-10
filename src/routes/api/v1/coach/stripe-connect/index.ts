import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { getStripeConnectStatus, stripeConnectStatusQuery } from "@/lib/stripe-connect.server";

export const stripeConnectStatusSchema = z.object({
  status: z.enum(["not_connected", "pending", "restricted", "active"]),
  accountId: z.string().nullable(),
  detailsSubmitted: z.boolean(),
  chargesEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
});

/**
 * Thin wrapper over `getStripeConnectStatus` in
 * `src/lib/stripe-connect.server.ts`: the caller's Stripe Connect account as
 * last synced, or asked of Stripe now with `?refresh=true` (on return from
 * onboarding).
 */
export const Route = createFileRoute("/api/v1/coach/stripe-connect/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/stripe-connect",
      operationId: "getStripeConnectStatus",
      auth: "user",
      summary: "The coach's Stripe Connect status",
      query: stripeConnectStatusQuery,
      output: stripeConnectStatusSchema,
      handler: async ({ ctx, query }) => {
        const { userId, admin } = requireContext(ctx);
        return getStripeConnectStatus({ userId, admin }, { refresh: query.refresh });
      },
    }),
  },
});
