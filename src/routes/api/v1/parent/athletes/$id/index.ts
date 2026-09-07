import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { athleteIdParam } from "@/lib/api/parent-params";
import {
  parentAthleteInput,
  removeParentAthlete,
  updateParentAthlete,
} from "@/lib/parent-settings.server";

/** Thin wrappers over the shared `updateParentAthlete` and `removeParentAthlete` (PRD §7.7). */
export const Route = createFileRoute("/api/v1/parent/athletes/$id/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "PATCH",
        path: "/api/v1/parent/athletes/{id}",
        operationId: "updateParentAthlete",
        auth: "user",
        summary: "Update an athlete's name and birthdate",
        input: parentAthleteInput,
        output: okSchema,
        handler: async ({ ctx, input, params }) => {
          const { userId, admin } = requireContext(ctx);
          return updateParentAthlete({ userId, admin }, athleteIdParam(params), input);
        },
      }),
      ...defineApiRoute({
        method: "DELETE",
        path: "/api/v1/parent/athletes/{id}",
        operationId: "removeParentAthlete",
        auth: "user",
        summary: "Remove an athlete (never the last one)",
        output: okSchema,
        handler: async ({ ctx, params }) => {
          const { userId, admin } = requireContext(ctx);
          return removeParentAthlete({ userId, admin }, athleteIdParam(params));
        },
      }),
    },
  },
});
