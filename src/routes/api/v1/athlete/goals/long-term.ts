import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { longTermGoalInput, updateAthleteLongTermGoal } from "@/lib/athlete-goals.server";

/** Thin wrapper over the shared `updateAthleteLongTermGoal` (PRD §7.7): the caller's long-term goal for one sport. */
export const Route = createFileRoute("/api/v1/athlete/goals/long-term")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/athlete/goals/long-term",
      operationId: "setAthleteLongTermGoal",
      auth: "user",
      summary: "Set the caller's long-term goal for a sport",
      input: longTermGoalInput,
      output: okSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase } = requireContext(ctx);
        return updateAthleteLongTermGoal({ userId, supabase }, input);
      },
    }),
  },
});
