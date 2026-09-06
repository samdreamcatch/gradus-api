import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { coachContext, coachLevelsSchema, saveCoachLevels } from "@/lib/coach-onboarding.server";

/**
 * Thin wrapper over the shared `saveCoachLevels`: replaces the coach's
 * sport/level rows and seeds starter moves for new sports. Onboarding
 * sends every level of each chosen sport at the suggested hours, as the
 * web does (`defaultEntriesForSports`).
 */
export const Route = createFileRoute("/api/v1/coach/levels")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/coach/levels",
      auth: "user",
      summary: "Replace the coach's sports and levels",
      input: coachLevelsSchema,
      output: okSchema,
      handler: async ({ ctx, input }) => saveCoachLevels(coachContext(requireContext(ctx)), input),
    }),
  },
});
