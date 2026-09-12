import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import {
  respondToCoachVisibility,
  respondToCoachVisibilityInput,
} from "@/lib/coach-visibility.server";

const bodySchema = respondToCoachVisibilityInput.omit({ linkId: true });

/**
 * Thin wrapper over the shared `respondToCoachVisibility` (PRD Appendix A).
 * `{id}` is the `coach_visibility_links.id` from `GET /coach/visibility/mine`.
 * Writes only the caller's side of the link. `[idem]` and by value, so an
 * outbox replay is harmless.
 */
export const Route = createFileRoute("/api/v1/coach/visibility/$id/respond")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/visibility/{id}/respond",
      operationId: "respondToCoachVisibility",
      auth: "user",
      idempotent: true,
      summary: "Accept or decline a coach visibility request",
      input: bodySchema,
      output: okSchema,
      handler: async ({ ctx, input, params }) => {
        const { admin, userId } = requireContext(ctx);
        return respondToCoachVisibility(
          admin,
          userId,
          { linkId: z.string().uuid().parse(params.id), accept: input.accept },
          { apiContract: true },
        );
      },
    }),
  },
});
