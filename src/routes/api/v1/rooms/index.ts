import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute, weakETag } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { roomSummarySchema } from "@/lib/api/messages-schema";
import { listRooms, roomsDigest, viewerRoleSchema } from "@/lib/messages.server";

const querySchema = z.object({ viewerRole: viewerRoleSchema.optional() });
const outputSchema = z.object({ rooms: z.array(roomSummarySchema) });

/**
 * Thin wrapper over the shared `listRooms` (src/lib/messages.server.ts) —
 * the web's `listMyRooms`. `[etag]` per Appendix A: the validator digests
 * room ids, activity stamps, unread counts, and last-message ids, so a
 * polling client gets 304 until something the list shows has changed.
 */
export const Route = createFileRoute("/api/v1/rooms/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/rooms",
      auth: "user",
      summary: "The caller's conversations, most recent activity first",
      query: querySchema,
      output: outputSchema,
      etag: (out) => weakETag(["rooms", roomsDigest(out.rooms)]),
      handler: async ({ ctx, query }) => listRooms({ userId: requireContext(ctx).userId }, query),
    }),
  },
});
