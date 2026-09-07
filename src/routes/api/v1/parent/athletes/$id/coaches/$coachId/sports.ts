import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { athleteIdParam, coachIdParam } from "@/lib/api/parent-params";
import { coachSportsInput, setParentAthleteCoachSports } from "@/lib/parent-settings.server";

/** Thin wrapper over the shared `setParentAthleteCoachSports` (PRD §7.7): replace the sports one coach works on with an athlete. */
export const Route = createFileRoute("/api/v1/parent/athletes/$id/coaches/$coachId/sports")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/parent/athletes/{id}/coaches/{coachId}/sports",
      operationId: "setParentAthleteCoachSports",
      auth: "user",
      summary: "Replace the sports an athlete does with a coach",
      input: coachSportsInput,
      output: okSchema,
      handler: async ({ ctx, input, params }) => {
        const { userId, admin } = requireContext(ctx);
        return setParentAthleteCoachSports(
          { userId, admin },
          athleteIdParam(params),
          coachIdParam(params),
          input,
        );
      },
    }),
  },
});
