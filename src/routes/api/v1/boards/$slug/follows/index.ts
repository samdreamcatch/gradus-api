import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { listFollows, replaceFollows } from "@/lib/api/board-follows";

const namesOutputSchema = z.array(z.string());

/**
 * New feature (PRD §6.9), not a reproduction of existing behavior. GET
 * lists the caller's current follows for this board — needed so a new
 * device/reinstall can show what's already followed; Appendix A lists
 * only PUT/DELETE, but a write-only follow list a client can never read
 * back isn't useful, so this was added as the obvious missing complement.
 */
export const Route = createFileRoute("/api/v1/boards/$slug/follows/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/boards/{slug}/follows",
        auth: "user",
        summary: "List the caller's followed skaters for a board",
        output: namesOutputSchema,
        handler: async ({ ctx, params }) => {
          const { admin, userId } = requireContext(ctx);
          return listFollows(admin, userId, params.slug);
        },
      }),
      ...defineApiRoute({
        method: "PUT",
        path: "/api/v1/boards/{slug}/follows",
        auth: "user",
        summary: "Replace the caller's followed skaters for a board",
        input: z.object({ names: z.array(z.string().min(1)) }),
        output: namesOutputSchema,
        handler: async ({ ctx, input, params }) => {
          const { admin, userId } = requireContext(ctx);
          return replaceFollows(admin, userId, params.slug, input.names);
        },
      }),
    },
  },
});
