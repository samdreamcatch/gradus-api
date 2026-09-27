import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { searchBoards } from "@/lib/board.server";

const querySchema = z.object({
  /** A competition name or place ("chicagoland", "lake placid"), an IJS link, or its number. */
  q: z.string().trim().min(2).max(120),
});

const outputSchema = z.array(
  z.object({
    slug: z.string(),
    name: z.string(),
    datesLabel: z.string(),
    location: z.string(),
    isLiveWindow: z.boolean(),
  }),
);

/**
 * Every U.S. Figure Skating IJS competition the catalog has found
 * (src/lib/ijs-catalog.server.ts), newest first; a pasted IJS link or
 * competition number is looked up on IJS right away. Each result's `slug`
 * opens with `GET /public/boards/{slug}` like any board; a competition nobody
 * has opened yet gets its board on that first open.
 */
export const Route = createFileRoute("/api/v1/public/boards/search")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/public/boards/search",
      operationId: "searchPublicBoards",
      auth: "public",
      summary: "Search every IJS competition for a Live Board",
      query: querySchema,
      output: outputSchema,
      rateLimit: { windowSeconds: 60, max: 30 },
      handler: async ({ query }) =>
        searchBoards(supabaseAdmin as unknown as { from: (t: string) => any }, query.q),
    }),
  },
});
