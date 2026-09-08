import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { dismissCoachPostEvent } from "@/lib/competition-results.server";

/** Thin wrapper over the shared `dismissCoachPostEvent` (PRD §7.10, Appendix A). */
export const Route = createFileRoute("/api/v1/coach/post-event/$id/dismiss")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/post-event/{id}/dismiss",
      operationId: "dismissCoachPostEvent",
      auth: "user",
      summary: "Stop asking the coach about a competition — no one competed",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { admin, userId } = requireContext(ctx);
        return dismissCoachPostEvent(admin, userId, {
          competitionId: z.string().uuid().parse(params.id),
        });
      },
    }),
  },
});
