import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { clearLessonOverride, isoDateSchema } from "@/lib/coach-roster.server";

/** Thin wrapper over the shared `clearLessonOverride`: put one date back on the regular schedule. */
export const Route = createFileRoute("/api/v1/coach/lesson-slots/$id/occurrences/$date/override")({
  server: {
    handlers: defineApiRoute({
      method: "DELETE",
      path: "/api/v1/coach/lesson-slots/{id}/occurrences/{date}/override",
      operationId: "clearLessonOverride",
      auth: "user",
      summary: "Remove a one-date override",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { userId, admin } = requireContext(ctx);
        return clearLessonOverride(
          { userId, admin },
          z.string().uuid().parse(params.id),
          isoDateSchema.parse(params.date),
        );
      },
    }),
  },
});
