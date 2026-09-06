import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { briefingSchema } from "@/lib/api/roster-schema";
import { briefingInput, getPreLessonBriefing } from "@/lib/pre-lesson-briefing.server";

/**
 * Thin wrapper over the shared `getPreLessonBriefing` (PRD §7.2 "Pre-lesson
 * briefing"): `?lessonDate=YYYY-MM-DD` and optional `?refresh=true`. The
 * server caches by a hash of the inputs; `fromCache` says which you got.
 */
export const Route = createFileRoute("/api/v1/coach/athletes/$id/briefing")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/athletes/{id}/briefing",
      operationId: "getPreLessonBriefing",
      auth: "user",
      rateLimit: { windowSeconds: 60, max: 30 },
      summary: "Pre-lesson briefing for an athlete and date",
      query: briefingInput,
      output: briefingSchema,
      handler: async ({ ctx, params, query }) => {
        const { userId, admin } = requireContext(ctx);
        return getPreLessonBriefing({ userId, admin }, z.string().uuid().parse(params.id), query);
      },
    }),
  },
});
