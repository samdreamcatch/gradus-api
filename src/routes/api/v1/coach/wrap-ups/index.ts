import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { recordLessonWrapUp, recordWrapUpInput } from "@/lib/lesson-wrap-ups.server";

/** Thin wrapper over the shared `recordLessonWrapUp`. `[idem]`; a repeat for the same (athlete, date) replaces the action. */
export const Route = createFileRoute("/api/v1/coach/wrap-ups/")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/wrap-ups",
      operationId: "recordWrapUp",
      auth: "user",
      idempotent: true,
      summary: "Record what the coach did after a lesson",
      input: recordWrapUpInput,
      output: okSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase } = requireContext(ctx);
        return recordLessonWrapUp({ userId, supabase }, input);
      },
    }),
  },
});
