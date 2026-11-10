import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { defineApiRoute, weakETag } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { planIdSchema, planListSchema } from "@/lib/api/plans-schema";
import { requirePlansCoach } from "@/lib/plan-detail.server";
import { createPlan, createPlanApiInput, listPlans, listPlansInput } from "@/lib/plans.server";

/**
 * Thin wrappers over the shared `listPlans` and `createPlan` (PRD §7.3
 * "Plans list", Appendix A `[etag]` / `[idem]`): the coach's plans filtered
 * by status, athlete, kind, and sport, and a new draft (or template),
 * optionally cloned from one of their plans. A retry never creates two.
 */
export const Route = createFileRoute("/api/v1/coach/plans/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/coach/plans",
        operationId: "listCoachPlans",
        auth: "user",
        summary: "The coach's plans, filtered",
        query: listPlansInput,
        output: planListSchema,
        etag: (body) =>
          weakETag([
            "plans",
            createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16),
          ]),
        handler: async ({ ctx, query }) => {
          const coach = await requirePlansCoach(requireContext(ctx));
          return { plans: await listPlans(coach, query) };
        },
      }),
      ...defineApiRoute({
        method: "POST",
        path: "/api/v1/coach/plans",
        operationId: "createPlan",
        auth: "user",
        idempotent: true,
        summary: "Create a draft plan or a template, optionally cloned",
        input: createPlanApiInput,
        output: planIdSchema,
        handler: async ({ ctx, input }) => {
          const coach = await requirePlansCoach(requireContext(ctx));
          return createPlan(coach, input);
        },
      }),
    },
  },
});
