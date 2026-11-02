import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { unreadNotificationCountSchema } from "@/lib/api/notifications-schema";
import { getUnreadNotificationCount } from "@/lib/notifications.server";

/** Thin wrapper over the shared `getUnreadNotificationCount` (the inbox badge). */
export const Route = createFileRoute("/api/v1/notifications/unread-count")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/notifications/unread-count",
      operationId: "getUnreadNotificationCount",
      auth: "user",
      summary: "Unread in-app notifications (badge)",
      output: unreadNotificationCountSchema,
      handler: async ({ ctx }) => {
        const { userId, supabase } = requireContext(ctx);
        return getUnreadNotificationCount({ userId, supabase });
      },
    }),
  },
});
