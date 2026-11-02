import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { markNotificationsRead, markNotificationsReadInput } from "@/lib/notifications.server";

/**
 * Thin wrapper over the shared `markNotificationsRead`: `{ ids }` marks those
 * rows read, `{ all: true }` every unread row. Repeats are harmless, so no
 * idempotency key is needed.
 */
export const Route = createFileRoute("/api/v1/notifications/read")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/notifications/read",
      operationId: "markNotificationsRead",
      auth: "user",
      summary: "Mark some or all of the caller's notifications read",
      input: markNotificationsReadInput,
      output: okSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase } = requireContext(ctx);
        return markNotificationsRead({ userId, supabase }, input);
      },
    }),
  },
});
