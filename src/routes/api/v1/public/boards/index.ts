import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchBoardList } from "@/lib/board.server";

const outputSchema = z.array(
  z.object({
    slug: z.string(),
    name: z.string(),
    datesLabel: z.string(),
    location: z.string(),
    isLiveWindow: z.boolean(),
  }),
);

/** Thin wrapper over the shared `fetchBoardList` (src/lib/board.server.ts). */
export const Route = createFileRoute("/api/v1/public/boards/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/public/boards",
      auth: "public",
      summary: "Competitions with a Live Board, newest first",
      output: outputSchema,
      handler: async () => fetchBoardList(supabaseAdmin as unknown as { from: (t: string) => any }),
    }),
  },
});
