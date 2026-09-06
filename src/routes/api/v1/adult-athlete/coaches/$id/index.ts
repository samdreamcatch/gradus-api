import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { ApiError } from "@/lib/api/errors";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { unlinkAdultAthleteFromCoach } from "@/lib/adult-athlete.server";

function coachId(raw: string): string {
  const id = z.string().uuid().safeParse(raw);
  if (!id.success) {
    throw new ApiError({ code: "validation_failed", status: 400, message: "Coach id must be a UUID." });
  }
  return id.data;
}

/** Thin wrapper over the shared `unlinkAdultAthleteFromCoach`: drop a coach and their coach-scoped data. */
export const Route = createFileRoute("/api/v1/adult-athlete/coaches/$id/")({
  server: {
    handlers: defineApiRoute({
      method: "DELETE",
      path: "/api/v1/adult-athlete/coaches/{id}",
      auth: "user",
      summary: "Unlink a coach",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { userId, supabase } = requireContext(ctx);
        return unlinkAdultAthleteFromCoach({ userId, supabase }, coachId(params.id));
      },
    }),
  },
});
