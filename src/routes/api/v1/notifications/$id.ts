import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { clearNotification } from "@/lib/notifications.server";

const notificationId = (params: Record<string, string>) => z.string().uuid().parse(params.id);

/**
 * Thin wrapper over the shared `clearNotification`: removes one row from the
 * caller's inbox. A row already cleared is still a 200.
 */
export const Route = createFileRoute("/api/v1/notifications/$id")({
  server: {
    handlers: defineApiRoute({
      method: "DELETE",
      path: "/api/v1/notifications/{id}",
      operationId: "clearNotification",
      auth: "user",
      summary: "Clear one notification from the caller's inbox",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { userId, supabase } = requireContext(ctx);
        return clearNotification({ userId, supabase }, notificationId(params));
      },
    }),
  },
});
