import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { ApiError } from "@/lib/api/errors";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { coachSportsInput, updateAdultAthleteCoachSports } from "@/lib/adult-athlete.server";

function coachId(raw: string): string {
  const id = z.string().uuid().safeParse(raw);
  if (!id.success) {
    throw new ApiError({ code: "validation_failed", status: 400, message: "Coach id must be a UUID." });
  }
  return id.data;
}

/** Thin wrapper over the shared `updateAdultAthleteCoachSports`: replace the sports one coach works on with the caller. */
export const Route = createFileRoute("/api/v1/adult-athlete/coaches/$id/sports")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/adult-athlete/coaches/{id}/sports",
      auth: "user",
      summary: "Set the sports for a linked coach",
      input: coachSportsInput,
      output: okSchema,
      handler: async ({ ctx, input, params }) =>
        updateAdultAthleteCoachSports(requireContext(ctx), coachId(params.id), input),
    }),
  },
});
