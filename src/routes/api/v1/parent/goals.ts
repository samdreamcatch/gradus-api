import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { parentGoalsResponseSchema } from "@/lib/api/family-goals-schema";
import { getParentGoalsDashboard } from "@/lib/parent-goals.server";

/**
 * Thin wrapper over the shared `getParentGoalsDashboard` (PRD §7.7 "Goals
 * dashboard"): every accessible athlete's goals with the trailing 28-day
 * practice numbers. No ETag — the trailing window moves with the clock.
 */
export const Route = createFileRoute("/api/v1/parent/goals")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/parent/goals",
      operationId: "getParentGoals",
      auth: "user",
      summary: "The parent's goals dashboard",
      output: parentGoalsResponseSchema,
      handler: async ({ ctx }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return { athletes: await getParentGoalsDashboard({ userId, supabase, admin }) };
      },
    }),
  },
});
