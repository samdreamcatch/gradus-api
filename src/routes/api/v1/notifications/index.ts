import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { notificationsPageSchema } from "@/lib/api/notifications-schema";
import {
  clearAllNotifications,
  getNotificationsPage,
  notificationsPageQuery,
} from "@/lib/notifications.server";

/**
 * Thin wrappers over the shared inbox functions in
 * `src/lib/notifications.server.ts`.
 *
 * `GET` `[page]`: `?limit=50&cursor=<opaque>&unreadOnly=true` returns
 * `{ items, nextCursor }`, newest first.
 *
 * `DELETE`: clears the caller's whole inbox. Already empty is still a 200.
 */
export const Route = createFileRoute("/api/v1/notifications/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/notifications",
        operationId: "getNotifications",
        auth: "user",
        summary: "One page of the caller's in-app notifications, newest first",
        query: notificationsPageQuery,
        output: notificationsPageSchema,
        handler: async ({ ctx, query }) => {
          const { userId, supabase } = requireContext(ctx);
          return getNotificationsPage({ userId, supabase }, query);
        },
      }),
      ...defineApiRoute({
        method: "DELETE",
        path: "/api/v1/notifications",
        operationId: "clearAllNotifications",
        auth: "user",
        summary: "Clear every notification in the caller's inbox",
        output: okSchema,
        handler: async ({ ctx }) => {
          const { userId, supabase } = requireContext(ctx);
          return clearAllNotifications({ userId, supabase });
        },
      }),
    },
  },
});
