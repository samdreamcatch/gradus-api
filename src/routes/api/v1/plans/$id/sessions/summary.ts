import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { planSessionsSummarySchema } from "@/lib/api/plans-schema";
import { getPlanSessionsSummary } from "@/lib/plan-sessions.server";

/** Thin wrapper over the shared `getPlanSessionsSummary` (PRD §7.3 "AI session summary"): 503 `ai_unavailable` when the model is down. */
export const Route = createFileRoute("/api/v1/plans/$id/sessions/summary")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/plans/{id}/sessions/summary",
      operationId: "getPlanSessionsSummary",
      auth: "user",
      rateLimit: { windowSeconds: 60, max: 10 },
      summary: "An AI summary of the sessions logged on a plan",
      output: planSessionsSummarySchema,
      handler: async ({ ctx, params }) => {
        const { supabase } = requireContext(ctx);
        return getPlanSessionsSummary({ supabase }, z.string().uuid().parse(params.id));
      },
    }),
  },
});
