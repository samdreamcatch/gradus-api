import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { coachSalesSchema } from "@/lib/api/marketplace-schema";
import { listCoachSales, purchaseListQuery } from "@/lib/plan-purchases.server";

/**
 * Thin wrapper over `listCoachSales` in `src/lib/plan-purchases.server.ts`:
 * the coach's plan sales, newest first, received and pending, with totals.
 * `?paymentStatus=pending` lists everything not paid yet; `canRestrict` marks
 * a buyer unpaid 3 days after payment became due.
 */
export const Route = createFileRoute("/api/v1/coach/sales/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/sales",
      operationId: "listCoachSales",
      auth: "user",
      summary: "The coach's plan sales: received and pending payments",
      query: purchaseListQuery,
      output: coachSalesSchema,
      handler: async ({ ctx, query }) => {
        const { userId, admin } = requireContext(ctx);
        return listCoachSales({ userId, admin }, query);
      },
    }),
  },
});
