import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { coachChecklistSchema } from "@/lib/api/coach-checklist-schema";
import { computeCoachChecklist } from "@/lib/coach-checklist.functions";

/**
 * Thin wrapper over the shared `computeCoachChecklist` — the web's
 * `getCoachChecklist` server function behind the roster "Get set up"
 * helper (PRD §7.2). Progress is derived from real data, so a step stays
 * ticked wherever the coach did it; the iOS onboarding helpers read this.
 * Dismissal is a client-side preference on both platforms.
 */
export const Route = createFileRoute("/api/v1/coach/checklist")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/checklist",
      operationId: "getCoachChecklist",
      auth: "user",
      summary: "Getting-started progress for the coach helpers",
      output: coachChecklistSchema,
      handler: async ({ ctx }) => {
        const { userId, admin } = requireContext(ctx);
        return computeCoachChecklist(admin, userId);
      },
    }),
  },
});
