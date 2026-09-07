import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { athleteIdParam } from "@/lib/api/parent-params";
import { parentAthleteGoalsInput, setParentAthleteGoals } from "@/lib/parent-settings.server";

/** Thin wrapper over the shared `setParentAthleteGoals` (PRD §7.7): the goal for (athlete, sport). */
export const Route = createFileRoute("/api/v1/parent/athletes/$id/goals")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/parent/athletes/{id}/goals",
      operationId: "setParentAthleteGoals",
      auth: "user",
      summary: "Set an athlete's goals for a sport",
      input: parentAthleteGoalsInput,
      output: okSchema,
      handler: async ({ ctx, input, params }) => {
        const { userId, admin } = requireContext(ctx);
        return setParentAthleteGoals({ userId, admin }, athleteIdParam(params), input);
      },
    }),
  },
});
