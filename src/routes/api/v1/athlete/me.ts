import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { myAthleteResponseSchema } from "@/lib/api/athlete-schema";
import { okSchema } from "@/lib/api/onboarding-schema";
import { getMyAthlete } from "@/lib/athlete-signup.server";
import { athleteSelfInput, updateAthleteSelf } from "@/lib/athlete-settings.server";

/**
 * Thin wrappers over the shared `getMyAthlete` (the signed-in athlete's own
 * row, or null) and `updateAthleteSelf` (PRD §7.12: the caller edits their
 * own name and birthdate; `apiContract` answers 404 for a caller with no
 * athlete row and 422 when the DB age rule rejects the birthdate).
 */
export const Route = createFileRoute("/api/v1/athlete/me")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/athlete/me",
        auth: "user",
        summary: "The caller's athlete row",
        output: myAthleteResponseSchema,
        handler: async ({ ctx }) => {
          const { userId, admin } = requireContext(ctx);
          return { athlete: await getMyAthlete({ userId, admin }) };
        },
      }),
      ...defineApiRoute({
        method: "PATCH",
        path: "/api/v1/athlete/me",
        operationId: "updateAthleteMe",
        auth: "user",
        summary: "Update the caller's name and birthdate",
        input: athleteSelfInput,
        output: okSchema,
        handler: async ({ ctx, input }) => {
          const { userId, admin } = requireContext(ctx);
          return updateAthleteSelf({ userId, admin }, input, { apiContract: true });
        },
      }),
    },
  },
});
