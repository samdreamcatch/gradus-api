import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { markRoomRead, viewerRoleSchema } from "@/lib/messages.server";

const inputSchema = z.object({ viewerRole: viewerRoleSchema.optional() }).optional();
const outputSchema = z.object({ marked: z.number() });

/** Thin wrapper over the shared `markRoomRead` (src/lib/messages.server.ts). */
export const Route = createFileRoute("/api/v1/rooms/$id/read")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/rooms/{id}/read",
      auth: "user",
      summary: "Mark every message from others in a conversation as read",
      input: inputSchema,
      output: outputSchema,
      handler: async ({ ctx, input, params }) => {
        const roomId = z.string().uuid().parse(params.id);
        return markRoomRead({ userId: requireContext(ctx).userId }, { roomId, viewerRole: input?.viewerRole });
      },
    }),
  },
});
