import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { adultSchedulesSchema } from "@/lib/api/athlete-schema";
import { getAdultAthleteSchedules } from "@/lib/adult-athlete.server";

/** Thin wrapper over the shared `getAdultAthleteSchedules`: lesson slots per linked coach. */
export const Route = createFileRoute("/api/v1/adult-athlete/schedules/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/adult-athlete/schedules",
      auth: "user",
      summary: "The caller's lesson schedules per coach",
      output: adultSchedulesSchema,
      handler: async ({ ctx }) => getAdultAthleteSchedules(requireContext(ctx)),
    }),
  },
});
