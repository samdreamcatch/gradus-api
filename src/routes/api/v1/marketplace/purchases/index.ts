import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { myPlanPurchasesSchema } from "@/lib/api/marketplace-schema";
import { listMyPlanPurchases, purchaseListQuery } from "@/lib/plan-purchases.server";

/**
 * Thin wrapper over `listMyPlanPurchases` in `src/lib/plan-purchases.server.ts`:
 * the caller's plan purchases, newest first, with whether each is paid,
 * waiting on the coach, or due. `?paymentStatus=pending` lists everything not
 * paid yet.
 */
export const Route = createFileRoute("/api/v1/marketplace/purchases/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/marketplace/purchases",
      operationId: "listMyMarketplacePurchases",
      auth: "user",
      summary: "The caller's plan purchases and their payment status",
      query: purchaseListQuery,
      output: myPlanPurchasesSchema,
      handler: async ({ ctx, query }) => {
        const { userId, admin } = requireContext(ctx);
        return listMyPlanPurchases({ userId, admin }, query);
      },
    }),
  },
});
