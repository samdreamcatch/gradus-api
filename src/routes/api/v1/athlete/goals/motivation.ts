import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { motivationInput, updateAthleteMotivation } from "@/lib/athlete-goals.server";

/** Thin wrapper over the shared `updateAthleteMotivation` (PRD §7.7): the caller's motivation line; 404 without an athlete row, like `long-term`. */
export const Route = createFileRoute("/api/v1/athlete/goals/motivation")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/athlete/goals/motivation",
      operationId: "setAthleteMotivation",
      auth: "user",
      summary: "Set the caller's motivation",
      input: motivationInput,
      output: okSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase } = requireContext(ctx);
        return updateAthleteMotivation({ userId, supabase }, input, { apiContract: true });
      },
    }),
  },
});
