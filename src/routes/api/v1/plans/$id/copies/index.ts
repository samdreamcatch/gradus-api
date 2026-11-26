import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { sharedPlanCopiesSchema } from "@/lib/api/plans-schema";
import { requirePlansCoach } from "@/lib/plan-detail.server";
import { sharePlan, sharePlanInput } from "@/lib/plans.server";

/**
 * One plan for several athletes (PRD decision #66, §7.3 "A plan for several
 * athletes"): each chosen athlete gets their own copy of this plan or
 * template, live now or as drafts. Answers with the plan the coach keeps
 * editing, whose `sharedWith` lists the copies. A retry never makes a second
 * copy for anyone.
 */
export const Route = createFileRoute("/api/v1/plans/$id/copies/")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/plans/{id}/copies",
      operationId: "sharePlanWithAthletes",
      auth: "user",
      idempotent: true,
      summary: "Give each chosen athlete their own copy of a plan",
      input: sharePlanInput,
      output: sharedPlanCopiesSchema,
      handler: async ({ ctx, input, params }) => {
        const coach = await requirePlansCoach(requireContext(ctx));
        return sharePlan(coach, z.string().uuid().parse(params.id), input);
      },
    }),
  },
});
