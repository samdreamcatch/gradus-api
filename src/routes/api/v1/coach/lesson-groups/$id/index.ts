import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import {
  deleteLessonGroup,
  updateLessonGroup,
  updateLessonGroupInput,
} from "@/lib/lesson-groups.server";

const groupId = (params: Record<string, string>) => z.string().uuid().parse(params.id);

/**
 * Thin wrappers over `updateLessonGroup` and `deleteLessonGroup` (PRD
 * decision #68, §6.16): a group lesson's schedule, price and athletes, or
 * its removal for everyone.
 */
export const Route = createFileRoute("/api/v1/coach/lesson-groups/$id/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "PATCH",
        path: "/api/v1/coach/lesson-groups/{id}",
        operationId: "updateLessonGroup",
        auth: "user",
        summary: "Move a group lesson, set its price, or add and remove athletes",
        input: updateLessonGroupInput,
        output: okSchema,
        handler: async ({ ctx, input, params }) => {
          const { userId, admin } = requireContext(ctx);
          return updateLessonGroup({ userId, admin }, groupId(params), input);
        },
      }),
      ...defineApiRoute({
        method: "DELETE",
        path: "/api/v1/coach/lesson-groups/{id}",
        operationId: "deleteLessonGroup",
        auth: "user",
        summary: "Delete a recurring group lesson for every athlete in it",
        output: okSchema,
        handler: async ({ ctx, params }) => {
          const { userId, admin } = requireContext(ctx);
          return deleteLessonGroup({ userId, admin }, groupId(params));
        },
      }),
    },
  },
});
