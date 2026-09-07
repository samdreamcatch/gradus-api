import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { athleteSettingsResponseSchema } from "@/lib/api/family-goals-schema";
import { getAthleteSettings } from "@/lib/athlete-settings.server";

/** Thin wrapper over the shared `getAthleteSettings` (PRD §7.12, Appendix A "Parent and athlete settings"): the caller's settings, or null. */
export const Route = createFileRoute("/api/v1/athlete/settings")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/athlete/settings",
      operationId: "getAthleteSettings",
      auth: "user",
      summary: "The caller's athlete settings",
      output: athleteSettingsResponseSchema,
      handler: async ({ ctx }) => {
        const { userId, admin } = requireContext(ctx);
        return { settings: await getAthleteSettings({ userId, admin }) };
      },
    }),
  },
});
