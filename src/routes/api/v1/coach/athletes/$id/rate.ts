import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { setAthleteRate, setAthleteRateBody } from "@/lib/invoicing.server";

/** Thin wrapper over the shared `setAthleteRate` (PRD §7.11 "Billing and invoicing"). */
export const Route = createFileRoute("/api/v1/coach/athletes/$id/rate")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/coach/athletes/{id}/rate",
      operationId: "setAthleteRate",
      auth: "user",
      summary: "Set an athlete's per-session or hourly rate",
      input: setAthleteRateBody,
      output: okSchema,
      handler: async ({ ctx, input, params }) => {
        const { userId, supabase } = requireContext(ctx);
        return setAthleteRate({ userId, supabase }, z.string().uuid().parse(params.id), input);
      },
    }),
  },
});
