import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { athleteScheduleInput, saveAthleteSchedule } from "@/lib/parent-signup.server";

/** Thin wrapper over the shared `saveAthleteSchedule`: replace one athlete's lesson slots for the coach behind the code. */
export const Route = createFileRoute("/api/v1/signup/parent/schedule")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/signup/parent/schedule",
      auth: "user",
      summary: "Save an athlete's lesson schedule",
      input: athleteScheduleInput,
      output: okSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return saveAthleteSchedule({ userId, admin }, input);
      },
    }),
  },
});
