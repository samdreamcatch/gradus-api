import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { athleteIdParam } from "@/lib/api/parent-params";
import { primaryCoachInput, setParentPrimaryCoach } from "@/lib/parent-settings.server";

/** Thin wrapper over the shared `setParentPrimaryCoach` (PRD §7.7): the primary coach for (athlete, sport). */
export const Route = createFileRoute("/api/v1/parent/athletes/$id/primary-coach")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/parent/athletes/{id}/primary-coach",
      operationId: "setParentAthletePrimaryCoach",
      auth: "user",
      summary: "Set an athlete's primary coach for a sport",
      input: primaryCoachInput,
      output: okSchema,
      handler: async ({ ctx, input, params }) => {
        const { userId, admin } = requireContext(ctx);
        return setParentPrimaryCoach({ userId, admin }, athleteIdParam(params), input);
      },
    }),
  },
});
