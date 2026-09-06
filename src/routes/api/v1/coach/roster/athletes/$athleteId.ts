import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { removeAthleteFromRoster } from "@/lib/coach-roster.server";

/** Thin wrapper over the shared `removeAthleteFromRoster`: unlink; the athlete's account and history stay. */
export const Route = createFileRoute("/api/v1/coach/roster/athletes/$athleteId")({
  server: {
    handlers: defineApiRoute({
      method: "DELETE",
      path: "/api/v1/coach/roster/athletes/{athleteId}",
      operationId: "removeRosterAthlete",
      auth: "user",
      summary: "Remove an athlete from the roster",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { userId, admin } = requireContext(ctx);
        return removeAthleteFromRoster(
          { userId, admin },
          z.string().uuid().parse(params.athleteId),
        );
      },
    }),
  },
});
