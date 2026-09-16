import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { slotIdSchema } from "@/lib/api/roster-schema";
import { addLessonSlot, addLessonSlotInput } from "@/lib/coach-roster.server";

/** Thin wrapper over the shared `addLessonSlot` (PRD §7.2 "Lesson slots"). `[idem]`: a retry never adds it twice. */
export const Route = createFileRoute("/api/v1/coach/lesson-slots/")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/lesson-slots",
      operationId: "addLessonSlot",
      auth: "user",
      idempotent: true,
      summary: "Add a recurring lesson for a rostered athlete",
      input: addLessonSlotInput,
      output: slotIdSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return addLessonSlot({ userId, admin }, input);
      },
    }),
  },
});
