import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { reportPlanInput } from "@/lib/plan-reports-types";
import { reportPlan } from "@/lib/plan-reports.server";

const outputSchema = z.object({
  ok: z.literal(true),
  reportId: z.string(),
  /** The caller had already reported this plan and it's still open: nothing new was filed. */
  alreadyReported: z.boolean(),
});

/**
 * Thin wrapper over `reportPlan` in `src/lib/plan-reports.server.ts`: "Report
 * this plan" on a marketplace plan (inappropriate, misleading or unsafe, with
 * an optional note). Emails the safety inbox, so it's rate-limited, and
 * `[idem]` so a retried report isn't filed twice. 404 for a plan the caller
 * can't see; 422 for the plan's own coach.
 */
export const Route = createFileRoute("/api/v1/marketplace/plans/$id/report")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/marketplace/plans/{id}/report",
      operationId: "reportMarketplacePlan",
      auth: "user",
      idempotent: true,
      rateLimit: { windowSeconds: 3600, max: 20 },
      summary: "Report a marketplace plan",
      input: reportPlanInput,
      output: outputSchema,
      handler: async ({ ctx, input, params }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return reportPlan({ userId, supabase, admin }, z.string().uuid().parse(params.id), input);
      },
    }),
  },
});
