import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { isoDateSchema } from "@/lib/coach-roster.server";
import {
  clearGroupOccurrence,
  setGroupOccurrence,
  setGroupOccurrenceInput,
} from "@/lib/lesson-groups.server";

const groupId = (params: Record<string, string>) => z.string().uuid().parse(params.id);
const date = (params: Record<string, string>) => isoDateSchema.parse(params.date);

/**
 * Thin wrappers over `setGroupOccurrence` and `clearGroupOccurrence` (PRD
 * decision #68, §6.16 C): who is out on one date of a group lesson (and
 * whether each is billed anyway), new times for that date, or the date back
 * on the regular schedule for everyone.
 */
export const Route = createFileRoute("/api/v1/coach/lesson-groups/$id/occurrences/$date/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "PUT",
        path: "/api/v1/coach/lesson-groups/{id}/occurrences/{date}",
        operationId: "setGroupOccurrence",
        auth: "user",
        summary: "Set who is out, and any new times, for one date of a group lesson",
        input: setGroupOccurrenceInput,
        output: okSchema,
        handler: async ({ ctx, input, params }) => {
          const { userId, admin } = requireContext(ctx);
          return setGroupOccurrence({ userId, admin }, groupId(params), date(params), input);
        },
      }),
      ...defineApiRoute({
        method: "DELETE",
        path: "/api/v1/coach/lesson-groups/{id}/occurrences/{date}",
        operationId: "clearGroupOccurrence",
        auth: "user",
        summary: "Put one date of a group lesson back on the regular schedule",
        output: okSchema,
        handler: async ({ ctx, params }) => {
          const { userId, admin } = requireContext(ctx);
          return clearGroupOccurrence({ userId, admin }, groupId(params), date(params));
        },
      }),
    },
  },
});
