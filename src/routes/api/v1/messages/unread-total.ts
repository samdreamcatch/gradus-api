import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { getUnreadTotal, viewerRoleSchema } from "@/lib/messages.server";

const querySchema = z.object({ viewerRole: viewerRoleSchema.optional() });
const outputSchema = z.object({ total: z.number() });

/** Thin wrapper over the shared `getUnreadTotal` (src/lib/messages.server.ts). */
export const Route = createFileRoute("/api/v1/messages/unread-total")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/messages/unread-total",
      auth: "user",
      summary: "Unread messages across the caller's conversations (tab badge)",
      query: querySchema,
      output: outputSchema,
      handler: async ({ ctx, query }) => getUnreadTotal({ userId: requireContext(ctx).userId }, query),
    }),
  },
});
