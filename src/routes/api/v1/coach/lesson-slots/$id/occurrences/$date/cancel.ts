import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { cancelLessonOccurrence, isoDateSchema } from "@/lib/coach-roster.server";

/** Thin wrapper over the shared `cancelLessonOccurrence`: skip one date; other weeks stay. */
export const Route = createFileRoute("/api/v1/coach/lesson-slots/$id/occurrences/$date/cancel")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/lesson-slots/{id}/occurrences/{date}/cancel",
      operationId: "cancelLessonOccurrence",
      auth: "user",
      summary: "Cancel one date of a recurring lesson",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { userId, admin } = requireContext(ctx);
        return cancelLessonOccurrence(
          { userId, admin },
          z.string().uuid().parse(params.id),
          isoDateSchema.parse(params.date),
        );
      },
    }),
  },
});
