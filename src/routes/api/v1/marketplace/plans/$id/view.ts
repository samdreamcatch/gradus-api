import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { recordPlanView } from "@/lib/coach-dashboard.server";

/**
 * Thin wrapper over `recordPlanView` in `src/lib/coach-dashboard.server.ts`:
 * the app calls this when someone opens a plan's marketplace page. Counted
 * once per person per plan per day, never for the plan's own coach.
 */
export const Route = createFileRoute("/api/v1/marketplace/plans/$id/view")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/marketplace/plans/{id}/view",
      operationId: "recordMarketplacePlanView",
      auth: "user",
      summary: "Count a view of a marketplace plan",
      output: z.object({ counted: z.boolean(), viewCount: z.number() }),
      handler: async ({ ctx, params }) => {
        const { userId, admin } = requireContext(ctx);
        return recordPlanView({ userId, admin }, z.string().uuid().parse(params.id));
      },
    }),
  },
});
