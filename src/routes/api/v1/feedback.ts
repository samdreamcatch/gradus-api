import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { feedbackInput, submitFeedback } from "@/lib/feedback.server";

/**
 * Thin wrapper over the shared `submitFeedback` (PRD §7.12 "Settings"):
 * one in-app feedback message, stamped with the caller's detected role.
 * `[idem]`: a retry never files the same message twice.
 */
export const Route = createFileRoute("/api/v1/feedback")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/feedback",
      operationId: "submitFeedback",
      auth: "user",
      idempotent: true,
      rateLimit: { windowSeconds: 3600, max: 20 },
      summary: "Send in-app feedback",
      input: feedbackInput,
      output: okSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return submitFeedback({ userId, admin }, input);
      },
    }),
  },
});
