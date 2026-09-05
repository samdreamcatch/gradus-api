import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { getRoomActivePlans, viewerRoleSchema } from "@/lib/messages.server";

const querySchema = z.object({ viewerRole: viewerRoleSchema.optional() });
const outputSchema = z.object({ plans: z.array(z.object({ id: z.string(), title: z.string() })) });

/** Thin wrapper over the shared `getRoomActivePlans` (src/lib/messages.server.ts). */
export const Route = createFileRoute("/api/v1/rooms/$id/active-plans")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/rooms/{id}/active-plans",
      auth: "user",
      summary: "Active plans that can be tagged in an athlete conversation",
      query: querySchema,
      output: outputSchema,
      handler: async ({ ctx, query, params }) => {
        const roomId = z.string().uuid().parse(params.id);
        return getRoomActivePlans({ userId: requireContext(ctx).userId }, { roomId, ...query });
      },
    }),
  },
});
