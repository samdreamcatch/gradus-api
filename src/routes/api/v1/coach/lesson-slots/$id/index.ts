import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { deleteLessonSlot, slotTimesInput, updateLessonSlot } from "@/lib/coach-roster.server";

const slotId = (params: Record<string, string>) => z.string().uuid().parse(params.id);

/** Thin wrappers over the shared `updateLessonSlot` and `deleteLessonSlot`: a recurring lesson's day and times, or its removal. */
export const Route = createFileRoute("/api/v1/coach/lesson-slots/$id/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "PATCH",
        path: "/api/v1/coach/lesson-slots/{id}",
        operationId: "updateLessonSlot",
        auth: "user",
        summary: "Move a recurring lesson or change its cadence",
        input: slotTimesInput,
        output: okSchema,
        handler: async ({ ctx, input, params }) => {
          const { userId, admin } = requireContext(ctx);
          return updateLessonSlot({ userId, admin }, slotId(params), input);
        },
      }),
      ...defineApiRoute({
        method: "DELETE",
        path: "/api/v1/coach/lesson-slots/{id}",
        operationId: "deleteLessonSlot",
        auth: "user",
        summary: "Delete a recurring lesson",
        output: okSchema,
        handler: async ({ ctx, params }) => {
          const { userId, admin } = requireContext(ctx);
          return deleteLessonSlot({ userId, admin }, slotId(params));
        },
      }),
    },
  },
});
