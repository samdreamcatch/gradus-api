import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { adultGoalsInput, saveAdultAthleteGoals } from "@/lib/adult-athlete.server";

/** Thin wrapper over the shared `saveAdultAthleteGoals`: one sport's level, target, and long-term goal. */
export const Route = createFileRoute("/api/v1/adult-athlete/goals")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/adult-athlete/goals",
      auth: "user",
      summary: "Save the caller's goals for a sport",
      input: adultGoalsInput,
      output: okSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return saveAdultAthleteGoals({ userId, supabase, admin }, input);
      },
    }),
  },
});
