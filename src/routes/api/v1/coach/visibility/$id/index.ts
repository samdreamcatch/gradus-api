import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { disconnectCoachVisibility } from "@/lib/coach-visibility.server";

/**
 * Thin wrapper over the shared `disconnectCoachVisibility` (PRD Appendix A).
 * `{id}` is the `coach_visibility_links.id`. Semantically a soft decline:
 * the caller's side is set to `declined` and the row stays, so the link
 * drops out of both coaches' lists; the parent re-requests by turning that
 * coach off and on again. Nothing is deleted.
 */
export const Route = createFileRoute("/api/v1/coach/visibility/$id/")({
  server: {
    handlers: defineApiRoute({
      method: "DELETE",
      path: "/api/v1/coach/visibility/{id}",
      operationId: "disconnectCoachVisibility",
      auth: "user",
      summary: "Turn a coach visibility connection off (soft decline of the caller's side)",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { admin, userId } = requireContext(ctx);
        return disconnectCoachVisibility(
          admin,
          userId,
          { linkId: z.string().uuid().parse(params.id) },
          { apiContract: true },
        );
      },
    }),
  },
});
