import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { otherCoachPlanForMessageSchema } from "@/lib/api/roster-schema";
import { getOtherCoachPlanForMessage } from "@/lib/coach-athlete-detail.server";

/**
 * Thin wrapper over the shared `getOtherCoachPlanForMessage` (Appendix A
 * "other-plan"): the read-only card for a plan chip in a thread that points
 * at another coach's plan. Club plan only; both coaches must be linked to
 * the athlete.
 */
export const Route = createFileRoute("/api/v1/coach/other-plans/$planId")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/other-plans/{planId}",
      operationId: "getOtherCoachPlan",
      auth: "user",
      summary: "Another coach's plan for a shared athlete, read-only",
      output: otherCoachPlanForMessageSchema,
      handler: async ({ ctx, params }) => {
        const { userId, admin } = requireContext(ctx);
        return getOtherCoachPlanForMessage(
          { userId, admin },
          z.string().uuid().parse(params.planId),
        );
      },
    }),
  },
});
