import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { adultCoachListSchema } from "@/lib/api/athlete-schema";
import { listAdultAthleteCoaches } from "@/lib/adult-athlete.server";

/** Thin wrapper over the shared `listAdultAthleteCoaches`: the caller's coaches with per-coach sports. */
export const Route = createFileRoute("/api/v1/adult-athlete/coaches/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/adult-athlete/coaches",
      auth: "user",
      summary: "The caller's linked coaches",
      output: adultCoachListSchema,
      handler: async ({ ctx }) => listAdultAthleteCoaches(requireContext(ctx)),
    }),
  },
});
