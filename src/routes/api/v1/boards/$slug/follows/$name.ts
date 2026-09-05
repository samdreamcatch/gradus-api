import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { removeFollow } from "@/lib/api/board-follows";

const outputSchema = z.object({ ok: z.literal(true) });

/** New feature (PRD §6.9): unfollow one skater on one board. */
export const Route = createFileRoute("/api/v1/boards/$slug/follows/$name")({
  server: {
    handlers: defineApiRoute({
      method: "DELETE",
      path: "/api/v1/boards/{slug}/follows/{name}",
      auth: "user",
      summary: "Unfollow one skater on a board",
      output: outputSchema,
      handler: async ({ ctx, params }) => {
        const { admin, userId } = requireContext(ctx);
        await removeFollow(admin, userId, params.slug, decodeURIComponent(params.name));
        return { ok: true as const };
      },
    }),
  },
});
