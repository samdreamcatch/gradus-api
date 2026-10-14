import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { assertAiConsent } from "@/lib/ai-consent.server";
import { aiSummarySchema } from "@/lib/api/roster-schema";
import { getCoachAthleteAiSummary } from "@/lib/coach-athlete-detail.server";

/**
 * Thin wrapper over the shared `getCoachAthleteAiSummary`: the 30-day
 * narrative and verdict. Generated on every call, as on the web; the client
 * caches it with an "as of" label (PRD §6.5). `ai_unavailable` (503) when
 * the model does not answer.
 */
export const Route = createFileRoute("/api/v1/coach/athletes/$id/ai-summary")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/athletes/{id}/ai-summary",
      operationId: "getCoachAthleteAiSummary",
      auth: "user",
      rateLimit: { windowSeconds: 60, max: 20 },
      summary: "AI summary of an athlete's last 30 days",
      output: aiSummarySchema,
      handler: async ({ ctx, params }) => {
        const { userId, admin } = requireContext(ctx);
        await assertAiConsent(admin, userId);
        return getCoachAthleteAiSummary({ userId, admin }, z.string().uuid().parse(params.id));
      },
    }),
  },
});
