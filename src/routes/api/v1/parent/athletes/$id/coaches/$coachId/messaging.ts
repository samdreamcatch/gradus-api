import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { messagingPauseResultSchema } from "@/lib/api/parent-settings-schema";
import { athleteIdParam, coachIdParam } from "@/lib/api/parent-params";
import {
  messagingPauseInput,
  setParentAthleteCoachMessagingPause,
} from "@/lib/parent-settings.server";

/**
 * Thin wrapper over the shared `setParentAthleteCoachMessagingPause` (PRD
 * §6.13 C, the SafeSport discontinue-contact rule): `{ paused: true }` stops
 * messages between this coach and the athlete in both directions; `false`
 * resumes. The coach is notified either way.
 */
export const Route = createFileRoute("/api/v1/parent/athletes/$id/coaches/$coachId/messaging")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/parent/athletes/{id}/coaches/{coachId}/messaging",
      operationId: "setParentAthleteCoachMessagingPause",
      auth: "user",
      summary: "Pause or resume messaging between a coach and the athlete",
      input: messagingPauseInput,
      output: messagingPauseResultSchema,
      handler: async ({ ctx, input, params }) => {
        const { userId, admin } = requireContext(ctx);
        return setParentAthleteCoachMessagingPause(
          { userId, admin },
          athleteIdParam(params),
          coachIdParam(params),
          input,
        );
      },
    }),
  },
});
