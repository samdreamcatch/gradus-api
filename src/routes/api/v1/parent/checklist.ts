import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { parentChecklistSchema } from "@/lib/api/parent-checklist-schema";
import { computeParentChecklist } from "@/lib/parent-checklist.functions";

/**
 * Thin wrapper over the shared `computeParentChecklist` — the web's
 * `getParentChecklist` server function behind the parent "Get set up"
 * helper (the parent's counterpart to `GET /coach/checklist`). Progress is
 * derived from real data, so a step stays ticked wherever the parent did
 * it; the iOS helper reads this. Dismissal is a client-side preference on
 * both platforms.
 */
export const Route = createFileRoute("/api/v1/parent/checklist")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/parent/checklist",
      operationId: "getParentChecklist",
      auth: "user",
      summary: "Getting-started progress for the parent helper",
      output: parentChecklistSchema,
      handler: async ({ ctx }) => {
        const { userId, admin } = requireContext(ctx);
        return computeParentChecklist(admin, userId);
      },
    }),
  },
});
