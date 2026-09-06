import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { unblockUser } from "@/lib/safety.server";

const okOutput = z.object({ ok: z.literal(true) });

/** Thin wrapper over the shared `unblockUser` (src/lib/safety.server.ts). */
export const Route = createFileRoute("/api/v1/safety/blocks/$userId")({
  server: {
    handlers: defineApiRoute({
      method: "DELETE",
      path: "/api/v1/safety/blocks/{userId}",
      auth: "user",
      summary: "Unblock a person",
      output: okOutput,
      handler: async ({ ctx, params }) => {
        const { userId, admin } = requireContext(ctx);
        const targetUserId = z.string().uuid().parse(params.userId);
        return unblockUser({ userId, admin }, { targetUserId });
      },
    }),
  },
});
