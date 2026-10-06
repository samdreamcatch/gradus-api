import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { setAthletePlanStatus, setAthletePlanStatusInput } from "@/lib/athlete-authoring.server";

/**
 * Thin wrapper over the shared `setAthletePlanStatus` (PRD §6.14 B): activate,
 * bench, or draft a plan the athlete wrote. No cap and no conflict (§12 #33):
 * those are coach-pairing rules.
 */
export const Route = createFileRoute("/api/v1/athlete/plans/$id/status")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/athlete/plans/{id}/status",
      operationId: "setAthletePlanStatus",
      auth: "user",
      summary: "Activate, bench, or draft a plan the athlete wrote",
      input: setAthletePlanStatusInput,
      output: okSchema,
      handler: async ({ ctx, input, params }) => {
        const { userId, supabase } = requireContext(ctx);
        return setAthletePlanStatus(
          { userId, supabase },
          z.string().uuid().parse(params.id),
          input,
        );
      },
    }),
  },
});
