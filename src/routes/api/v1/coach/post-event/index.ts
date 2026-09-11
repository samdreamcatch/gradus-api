import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { coachPostEventItemSchema } from "@/lib/api/competition-results-schema";
import { getCoachPostEventItems } from "@/lib/competition-results.server";

/** Thin wrapper over the shared `getCoachPostEventItems` (PRD §7.10, Appendix A). */
export const Route = createFileRoute("/api/v1/coach/post-event/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/post-event",
      operationId: "getCoachPostEventItems",
      auth: "user",
      summary: "Recently finished competitions the coach watched, with linked athletes to handle",
      output: z.array(coachPostEventItemSchema),
      handler: async ({ ctx }) => {
        const { admin, userId } = requireContext(ctx);
        return getCoachPostEventItems(admin, userId);
      },
    }),
  },
});
