import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { lessonGroupCreatedSchema } from "@/lib/api/roster-schema";
import { createLessonGroup, createLessonGroupInput } from "@/lib/lesson-groups.server";

/**
 * Thin wrapper over `createLessonGroup` (PRD decision #68, §6.16): one
 * recurring lesson for two to eight rostered athletes. `[idem]`: a retry
 * never adds the group twice.
 */
export const Route = createFileRoute("/api/v1/coach/lesson-groups/")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/lesson-groups",
      operationId: "createLessonGroup",
      auth: "user",
      idempotent: true,
      summary: "Add a recurring group lesson for two to eight rostered athletes",
      input: createLessonGroupInput,
      output: lessonGroupCreatedSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return createLessonGroup({ userId, admin }, input);
      },
    }),
  },
});
