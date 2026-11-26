import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { updatedPlanCopiesSchema } from "@/lib/api/plans-schema";
import { requirePlansCoach } from "@/lib/plan-detail.server";
import { updatePlanCopies, updateCopiesInput } from "@/lib/plans.server";

/**
 * "Update & Share" (PRD decision #66): the chosen athletes' copies are made to
 * match the plan as it is now, and each live copy that changed tells its
 * household. The coach chooses who each time; a copy with custom edits is only
 * replaced when its athlete is named. A retry tells nobody twice.
 */
export const Route = createFileRoute("/api/v1/plans/$id/copies/update")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/plans/{id}/copies/update",
      operationId: "updatePlanCopies",
      auth: "user",
      idempotent: true,
      summary: "Send the plan's changes to chosen athletes' copies",
      input: updateCopiesInput,
      output: updatedPlanCopiesSchema,
      handler: async ({ ctx, input, params }) => {
        const coach = await requirePlansCoach(requireContext(ctx));
        return updatePlanCopies(coach, z.string().uuid().parse(params.id), input);
      },
    }),
  },
});
