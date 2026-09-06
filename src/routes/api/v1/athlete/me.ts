import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { myAthleteResponseSchema } from "@/lib/api/athlete-schema";
import { getMyAthlete } from "@/lib/athlete-signup.server";

/** Thin wrapper over the shared `getMyAthlete`: the signed-in athlete's own row, or null. */
export const Route = createFileRoute("/api/v1/athlete/me")({
  server: {
    handlers: defineApiRoute({
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
  },
});
