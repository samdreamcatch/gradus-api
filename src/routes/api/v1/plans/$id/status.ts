import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { requirePlansCoach } from "@/lib/plan-detail.server";
import { setPlanStatus, setPlanStatusInput } from "@/lib/plans.server";

/**
 * Thin wrapper over the shared `setPlanStatus` (PRD §7.3 "Status"):
 * activate, bench, or draft. There is no cap on active plans per athlete
 * (PRD decision #52), so activation never answers 409 `bench_choice_required`
 * any more; an optional `replaceId` benches that plan in the same step.
 */
export const Route = createFileRoute("/api/v1/plans/$id/status")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/plans/{id}/status",
      operationId: "setPlanStatus",
      auth: "user",
      summary: "Activate, bench, or draft a plan",
      input: setPlanStatusInput,
      output: okSchema,
      handler: async ({ ctx, input, params }) => {
        const coach = await requirePlansCoach(requireContext(ctx));
        return setPlanStatus(coach, z.string().uuid().parse(params.id), input);
      },
    }),
  },
});
