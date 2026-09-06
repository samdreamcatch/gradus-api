import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { athleteGoalsInput, saveAthleteGoals } from "@/lib/parent-signup.server";

/** Thin wrapper over the shared `saveAthleteGoals`: one athlete's level, target, and long-term goal for a sport. */
export const Route = createFileRoute("/api/v1/signup/parent/goals")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/signup/parent/goals",
      auth: "user",
      summary: "Save an athlete's goals",
      input: athleteGoalsInput,
      output: okSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return saveAthleteGoals({ userId, admin }, input);
      },
    }),
  },
});
