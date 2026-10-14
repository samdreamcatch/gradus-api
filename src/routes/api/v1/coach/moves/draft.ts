import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { assertAiConsent } from "@/lib/ai-consent.server";
import { moveDraftSchema } from "@/lib/api/plans-schema";
import { draftMove, moveDraftInput } from "@/lib/move-draft.server";

/**
 * Thin wrapper over the shared `draftMove` (PRD decision #53): AI
 * suggestions for a new move's description, cue and why. Coach-only, writes
 * nothing, so no idempotency key. Rate-limited per coach inside `draftMove`
 * (30 an hour, shared with the web), so no route-level limit here.
 * 503 `ai_unavailable` when the model is down.
 */
export const Route = createFileRoute("/api/v1/coach/moves/draft")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/moves/draft",
      operationId: "draftMove",
      auth: "user",
      summary: "AI draft of a new move's description, cue and why",
      input: moveDraftInput,
      output: moveDraftSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        await assertAiConsent(admin, userId);
        return draftMove({ userId, supabase, admin }, input);
      },
    }),
  },
});
