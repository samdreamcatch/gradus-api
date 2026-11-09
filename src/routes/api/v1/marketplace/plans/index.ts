import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { marketplacePlansPageSchema } from "@/lib/api/marketplace-schema";
import { getMarketplacePlans, marketplacePlansQuery } from "@/lib/marketplace-plans.server";

/**
 * Thin wrapper over the shared `getMarketplacePlans` in
 * `src/lib/marketplace-plans.server.ts`.
 *
 * `GET` `[page]`: `?q=&limit=20&cursor=<opaque>` returns `{ items, nextCursor }`,
 * newest first: active plans by Coach Pro coaches, without the ones assigned to
 * the caller or their athletes. The caller's own plans are included, flagged
 * `isOwn`.
 */
export const Route = createFileRoute("/api/v1/marketplace/plans/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/marketplace/plans",
      operationId: "listMarketplacePlans",
      auth: "user",
      summary: "Active plans by Coach Pro coaches that the caller doesn't already have",
      query: marketplacePlansQuery,
      output: marketplacePlansPageSchema,
      handler: async ({ ctx, query }) => {
        const { userId, admin } = requireContext(ctx);
        return getMarketplacePlans({ userId, admin }, query);
      },
    }),
  },
});
