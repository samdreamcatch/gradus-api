import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { messageSchema, roomDetailRoomSchema } from "@/lib/api/messages-schema";
import { getRoomPage, roomPageQuery } from "@/lib/messages.server";

const outputSchema = z.object({
  room: roomDetailRoomSchema,
  items: z.array(messageSchema),
  nextCursor: z.string().nullable(),
});

/**
 * Thin wrapper over the shared `getRoomPage` (src/lib/messages.server.ts):
 * the room header plus one page of messages, `[page]` per Appendix A and
 * PRD §6.2 — `?limit=50&cursor=<opaque>` returns `{ items, nextCursor }`.
 * The first page is the newest messages; each page is oldest-first so it
 * reads like a thread; `nextCursor` walks back in time and is null on the
 * last page. (The web's `getRoom` keeps its whole-thread shape.)
 */
export const Route = createFileRoute("/api/v1/rooms/$id/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/rooms/{id}",
      auth: "user",
      summary: "A conversation and one page of its messages",
      query: roomPageQuery,
      output: outputSchema,
      handler: async ({ ctx, query, params }) => {
        const roomId = z.string().uuid().parse(params.id);
        return getRoomPage({ userId: requireContext(ctx).userId }, { roomId, ...query });
      },
    }),
  },
});
