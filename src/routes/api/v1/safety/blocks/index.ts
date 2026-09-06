import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { blockedUserSchema } from "@/lib/api/messages-schema";
import { blockInput, blockUser, listBlocks } from "@/lib/safety.server";

const listOutput = z.object({ blocks: z.array(blockedUserSchema) });
const okOutput = z.object({ ok: z.literal(true) });

/**
 * Thin wrappers over the shared `listBlocks` / `blockUser`
 * (src/lib/safety.server.ts). Blocking is a full disconnect (PRD §6.11
 * "User-generated content"): messaging stops both ways and coaching links
 * are severed; history is kept.
 */
export const Route = createFileRoute("/api/v1/safety/blocks/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/safety/blocks",
        auth: "user",
        summary: "People the caller has blocked",
        output: listOutput,
        handler: async ({ ctx }) => {
          const { userId, admin } = requireContext(ctx);
          return listBlocks({ userId, admin });
        },
      }),
      ...defineApiRoute({
        method: "POST",
        path: "/api/v1/safety/blocks",
        auth: "user",
        summary: "Block a person",
        input: blockInput,
        output: okOutput,
        handler: async ({ ctx, input }) => {
          const { userId, admin } = requireContext(ctx);
          return blockUser({ userId, admin }, input);
        },
      }),
    },
  },
});
