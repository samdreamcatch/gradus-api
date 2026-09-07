import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { athleteIdParam, coachIdParam } from "@/lib/api/parent-params";
import { unlinkParentAthleteFromCoach } from "@/lib/parent-settings.server";

/** Thin wrapper over the shared `unlinkParentAthleteFromCoach` (PRD §7.7): drop a coach and their coach-scoped data. */
export const Route = createFileRoute("/api/v1/parent/athletes/$id/coaches/$coachId/")({
  server: {
    handlers: defineApiRoute({
      method: "DELETE",
      path: "/api/v1/parent/athletes/{id}/coaches/{coachId}",
      operationId: "unlinkParentAthleteCoach",
      auth: "user",
      summary: "Unlink a coach from an athlete",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { userId, admin } = requireContext(ctx);
        return unlinkParentAthleteFromCoach(
          { userId, admin },
          athleteIdParam(params),
          coachIdParam(params),
        );
      },
    }),
  },
});
