import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { planDetailSchema, planIdSchema, updatePlanResultSchema } from "@/lib/api/plans-schema";
import { getPlanForViewer, requirePlansCoach } from "@/lib/plan-detail.server";
import { deletePlan, savePlan, savePlanInput, updatePlan, updatePlanPatch } from "@/lib/plans.server";

const planId = (params: Record<string, string>) => z.string().uuid().parse(params.id);

/**
 * One plan (PRD §7.3 "Plan detail and editor", Appendix A "role-aware"):
 * GET serves the coach, parent, or athlete view in one shape; PUT is the
 * whole-plan save (row plus a full replacement of its moves); PATCH is the
 * per-field update, which forks an active plan when its athlete changes;
 * DELETE removes templates, drafts, and benched plans (422 `not_deletable`
 * for an active plan — bench it first).
 */
export const Route = createFileRoute("/api/v1/plans/$id/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/plans/{id}",
        operationId: "getPlan",
        auth: "user",
        summary: "A plan, as the caller's role sees it",
        output: planDetailSchema,
        handler: async ({ ctx, params }) => getPlanForViewer(requireContext(ctx), planId(params)),
      }),
      ...defineApiRoute({
        method: "PUT",
        path: "/api/v1/plans/{id}",
        operationId: "savePlan",
        auth: "user",
        summary: "Replace a plan's fields and moves",
        input: savePlanInput.omit({ id: true }),
        output: planIdSchema,
        handler: async ({ ctx, input, params }) => {
          const coach = await requirePlansCoach(requireContext(ctx));
          return savePlan(coach, { ...input, id: planId(params) });
        },
      }),
      ...defineApiRoute({
        method: "PATCH",
        path: "/api/v1/plans/{id}",
        operationId: "updatePlan",
        auth: "user",
        summary: "Update a plan's title, notes, kind, or athlete",
        input: updatePlanPatch,
        output: updatePlanResultSchema,
        handler: async ({ ctx, input, params }) => {
          const coach = await requirePlansCoach(requireContext(ctx));
          return updatePlan(coach, planId(params), input);
        },
      }),
      ...defineApiRoute({
        method: "DELETE",
        path: "/api/v1/plans/{id}",
        operationId: "deletePlan",
        auth: "user",
        summary: "Delete a template, draft, or benched plan",
        output: okSchema,
        handler: async ({ ctx, params }) => {
          const coach = await requirePlansCoach(requireContext(ctx));
          return deletePlan(coach, planId(params));
        },
      }),
    },
  },
});
