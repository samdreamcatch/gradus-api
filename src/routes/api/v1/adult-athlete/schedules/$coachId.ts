import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { ApiError } from "@/lib/api/errors";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { adultScheduleInput, saveAdultAthleteScheduleForCoach } from "@/lib/adult-athlete.server";

/** Thin wrapper over the shared `saveAdultAthleteScheduleForCoach`: replace the caller's lesson slots with one coach. */
export const Route = createFileRoute("/api/v1/adult-athlete/schedules/$coachId")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/adult-athlete/schedules/{coachId}",
      auth: "user",
      summary: "Save the caller's lesson schedule with a coach",
      input: adultScheduleInput,
      output: okSchema,
      handler: async ({ ctx, input, params }) => {
        const id = z.string().uuid().safeParse(params.coachId);
        if (!id.success) {
          throw new ApiError({ code: "validation_failed", status: 400, message: "Coach id must be a UUID." });
        }
        return saveAdultAthleteScheduleForCoach(requireContext(ctx), id.data, input);
      },
    }),
  },
});
