import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { athleteGoalsResponseSchema } from "@/lib/api/family-goals-schema";
import { getAthleteGoalsDashboard } from "@/lib/athlete-goals.server";

/**
 * Thin wrapper over the shared `getAthleteGoalsDashboard` (PRD §7.7 "Goals
 * dashboard"): the caller's sports, motivation, and trailing 28-day
 * practice numbers, or null when they have no athlete row.
 */
export const Route = createFileRoute("/api/v1/athlete/goals/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/athlete/goals",
      operationId: "getAthleteGoals",
      auth: "user",
      summary: "The athlete's goals dashboard",
      output: athleteGoalsResponseSchema,
      handler: async ({ ctx }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return { dashboard: await getAthleteGoalsDashboard({ userId, supabase, admin }) };
      },
    }),
  },
});
