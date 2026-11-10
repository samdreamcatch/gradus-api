import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { coachDashboardSchema } from "@/lib/api/marketplace-schema";
import { getCoachDashboard } from "@/lib/coach-dashboard.server";

/**
 * Thin wrapper over `getCoachDashboard` in `src/lib/coach-dashboard.server.ts`:
 * the coach's seller dashboard: sales, earnings, pending payments, views and
 * conversion, rating, their marketplace plans, weekly performance, and (once
 * on Stripe) their balance and bank payouts.
 */
export const Route = createFileRoute("/api/v1/coach/marketplace/dashboard")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/marketplace/dashboard",
      operationId: "getCoachMarketplaceDashboard",
      auth: "user",
      summary: "The coach's marketplace seller dashboard",
      output: coachDashboardSchema,
      handler: async ({ ctx }) => {
        const { userId, admin } = requireContext(ctx);
        return getCoachDashboard({ userId, admin });
      },
    }),
  },
});
