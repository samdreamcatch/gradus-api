import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { athleteDetailSchema } from "@/lib/api/roster-schema";
import { getCoachAthleteDetail } from "@/lib/coach-athlete-detail.server";

/** Thin wrapper over the shared `getCoachAthleteDetail` (PRD §7.2 "Athlete detail sheet"). */
export const Route = createFileRoute("/api/v1/coach/athletes/$id/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/athletes/{id}",
      operationId: "getCoachAthleteDetail",
      auth: "user",
      summary: "The coach's view of one rostered athlete",
      output: athleteDetailSchema,
      handler: async ({ ctx, params }) => {
        const { userId, admin } = requireContext(ctx);
        return getCoachAthleteDetail({ userId, admin }, z.string().uuid().parse(params.id));
      },
    }),
  },
});
