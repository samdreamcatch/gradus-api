import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { planPurchaseSchema } from "@/lib/api/marketplace-schema";
import { restrictPlanPurchase } from "@/lib/plan-purchases.server";

/**
 * Thin wrapper over `restrictPlanPurchase` in `src/lib/plan-purchases.server.ts`:
 * the coach removes an unpaid buyer's access to the plan (their copy is
 * deleted). Only once the payment is 3 days overdue: 409 `not_overdue` before
 * that. Restricting again is a no-op.
 */
export const Route = createFileRoute("/api/v1/coach/sales/$id/restrict")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/sales/{id}/restrict",
      operationId: "restrictCoachSale",
      auth: "user",
      summary: "Restrict a buyer who hasn't paid for a plan",
      output: planPurchaseSchema,
      handler: async ({ ctx, params }) => {
        const { userId, admin } = requireContext(ctx);
        return restrictPlanPurchase({ userId, admin }, z.string().uuid().parse(params.id));
      },
    }),
  },
});
