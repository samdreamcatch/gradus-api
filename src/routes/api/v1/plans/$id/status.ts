import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { requirePlansCoach } from "@/lib/plan-detail.server";
import { setPlanStatus, setPlanStatusInput } from "@/lib/plans.server";

/**
 * Thin wrapper over the shared `setPlanStatus` (PRD §7.3 "Status"):
 * activate, bench, or draft. Activating past the per-athlete cap without a
 * `replaceId` answers 409 `bench_choice_required` with the active plans in
 * `details.activePlans`, the same rule the web maps to its friendly copy.
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
