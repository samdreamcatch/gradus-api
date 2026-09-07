import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { resourceIdResultSchema, savedAnswersSchema } from "@/lib/api/resources-schema";
import { listSavedAnswers, saveAnswer, saveAnswerInput } from "@/lib/saved-answers.server";

/**
 * Thin wrappers over the shared `listSavedAnswers` and `saveAnswer`
 * (PRD §7.9, Appendix A "Resources and Ask Gradus"). The list is wrapped in
 * `{ answers }` for the Swift generator — bare top-level arrays aren't
 * allowed (see `roster-schema.ts`'s "summaries" envelope for the pattern).
 * `[idem]`: a retried save never inserts the same answer twice.
 */
export const Route = createFileRoute("/api/v1/saved-answers/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/saved-answers",
        operationId: "listSavedAnswers",
        auth: "user",
        summary: "The caller's saved Ask Gradus answers",
        output: savedAnswersSchema,
        handler: async ({ ctx }) => {
          const { userId, supabase } = requireContext(ctx);
          const answers = await listSavedAnswers({ userId, supabase });
          return { answers };
        },
      }),
      ...defineApiRoute({
        method: "POST",
        path: "/api/v1/saved-answers",
        operationId: "saveAnswer",
        auth: "user",
        idempotent: true,
        summary: "Save an Ask Gradus answer",
        input: saveAnswerInput,
        output: resourceIdResultSchema,
        handler: async ({ ctx, input }) => {
          const { userId, supabase } = requireContext(ctx);
          return saveAnswer({ userId, supabase }, input);
        },
      }),
    },
  },
});
