import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import {
  isoDateSchema,
  occurrenceTimesInput,
  rescheduleLessonOccurrence,
} from "@/lib/coach-roster.server";

/** Thin wrapper over the shared `rescheduleLessonOccurrence`: new times for one date only. */
export const Route = createFileRoute("/api/v1/coach/lesson-slots/$id/occurrences/$date/reschedule")(
  {
    server: {
      handlers: defineApiRoute({
        method: "POST",
        path: "/api/v1/coach/lesson-slots/{id}/occurrences/{date}/reschedule",
        operationId: "rescheduleLessonOccurrence",
        auth: "user",
        summary: "Reschedule one date of a recurring lesson",
        input: occurrenceTimesInput,
        output: okSchema,
        handler: async ({ ctx, input, params }) => {
          const { userId, admin } = requireContext(ctx);
          return rescheduleLessonOccurrence(
            { userId, admin },
            z.string().uuid().parse(params.id),
            isoDateSchema.parse(params.date),
            input,
          );
        },
      }),
    },
  },
);
