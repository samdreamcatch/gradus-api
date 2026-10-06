import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { upNextSchema } from "@/lib/api/roster-schema";
import { getUpNext, upNextInput } from "@/lib/coach-up-next.server";

/**
 * Thin wrapper over the shared `getUpNext` (PRD §6.15, §10.11 W2): the coach's
 * lessons today that have not ended, soonest first, with whether a briefing is
 * cached, so the watch never pulls the whole roster. The client sends its local
 * `?lessonDate&dayOfWeek&currentMinute`, as for `/coach/wrap-ups/pending`.
 */
export const Route = createFileRoute("/api/v1/coach/up-next")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/up-next",
      operationId: "getCoachUpNext",
      auth: "user",
      rateLimit: { windowSeconds: 60, max: 30 },
      summary: "The coach's lessons today that have not ended, soonest first",
      query: upNextInput,
      output: upNextSchema,
      handler: async ({ ctx, query }) => {
        const { userId, admin } = requireContext(ctx);
        return { upNext: await getUpNext({ userId, admin }, query) };
      },
    }),
  },
});
