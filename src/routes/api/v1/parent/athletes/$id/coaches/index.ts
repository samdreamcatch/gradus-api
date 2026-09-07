import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { athleteIdParam } from "@/lib/api/parent-params";
import { linkCoachInput, linkParentAthleteToCoach } from "@/lib/parent-settings.server";

/**
 * Thin wrapper over the shared `linkParentAthleteToCoach` (PRD §7.7): link
 * an athlete to the coach behind an invite code, scoped to the chosen
 * sports. `[idem]`: a retry never links twice; an existing link answers
 * 409 `already_linked`.
 */
export const Route = createFileRoute("/api/v1/parent/athletes/$id/coaches/")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/parent/athletes/{id}/coaches",
      operationId: "linkParentAthleteCoach",
      auth: "user",
      idempotent: true,
      summary: "Link an athlete to a coach by invite code",
      input: linkCoachInput,
      output: okSchema,
      handler: async ({ ctx, input, params }) => {
        const { userId, admin } = requireContext(ctx);
        return linkParentAthleteToCoach({ userId, admin }, athleteIdParam(params), input);
      },
    }),
  },
});
