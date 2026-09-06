import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { pendingWrapUpsSchema } from "@/lib/api/roster-schema";
import { getPendingLessonWrapUps, pendingWrapUpsInput } from "@/lib/lesson-wrap-ups.server";

/**
 * Thin wrapper over the shared `getPendingLessonWrapUps` (PRD §7.2 "Lesson
 * wrap-ups"): today's ended lessons not yet wrapped up. The client sends its
 * local `?lessonDate&dayOfWeek&currentMinute`, since slots are wall-clock
 * times in the coach's day.
 */
export const Route = createFileRoute("/api/v1/coach/wrap-ups/pending")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/wrap-ups/pending",
      operationId: "getPendingWrapUps",
      auth: "user",
      summary: "Lessons that ended today and still need a wrap-up",
      query: pendingWrapUpsInput,
      output: pendingWrapUpsSchema,
      handler: async ({ ctx, query }) => {
        const { userId, supabase } = requireContext(ctx);
        return { wrapUps: await getPendingLessonWrapUps({ userId, supabase }, query) };
      },
    }),
  },
});
