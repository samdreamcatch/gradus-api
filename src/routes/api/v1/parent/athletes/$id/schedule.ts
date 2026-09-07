import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { athleteIdParam } from "@/lib/api/parent-params";
import { parentScheduleInput, replaceParentAthleteSchedule } from "@/lib/parent-settings.server";

/**
 * Thin wrapper over the shared `replaceParentAthleteSchedule` (PRD §7.7):
 * replace the athlete's lesson slots with one coach. The coach travels in
 * the body (`coachId`) because schedules are stored per coach.
 */
export const Route = createFileRoute("/api/v1/parent/athletes/$id/schedule")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/parent/athletes/{id}/schedule",
      operationId: "replaceParentAthleteSchedule",
      auth: "user",
      summary: "Replace an athlete's lesson schedule with a coach",
      input: parentScheduleInput,
      output: okSchema,
      handler: async ({ ctx, input, params }) => {
        const { userId, admin } = requireContext(ctx);
        return replaceParentAthleteSchedule({ userId, admin }, athleteIdParam(params), input);
      },
    }),
  },
});
