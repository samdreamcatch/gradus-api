import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { savedAnswerIdParam } from "@/lib/api/resources-params";
import { deleteSavedAnswer } from "@/lib/saved-answers.server";

/** Thin wrapper over the shared `deleteSavedAnswer` (PRD §7.9, Appendix A "Resources and Ask Gradus"). */
export const Route = createFileRoute("/api/v1/saved-answers/$id")({
  server: {
    handlers: defineApiRoute({
      method: "DELETE",
      path: "/api/v1/saved-answers/{id}",
      operationId: "deleteSavedAnswer",
      auth: "user",
      summary: "Delete one of the caller's saved Ask Gradus answers",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { userId, supabase } = requireContext(ctx);
        return deleteSavedAnswer({ userId, supabase }, savedAnswerIdParam(params));
      },
    }),
  },
});
