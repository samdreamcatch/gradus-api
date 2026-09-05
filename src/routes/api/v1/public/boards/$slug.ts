import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { ApiError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { boardPayloadSchema } from "@/lib/api/board-schema";
import { fetchBoard } from "@/lib/board.server";

const outputSchema = z.object({
  slug: z.string(),
  name: z.string(),
  datesLabel: z.string(),
  location: z.string(),
  active: z.boolean(),
  isLiveWindow: z.boolean(),
  generatedAt: z.string().nullable(),
  error: z.string().nullable(),
  payload: boardPayloadSchema.nullable(),
});

/** Thin wrapper over the shared `fetchBoard` (src/lib/board.server.ts). */
export const Route = createFileRoute("/api/v1/public/boards/$slug")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/public/boards/{slug}",
      auth: "public",
      summary: "One competition's Live Board",
      output: outputSchema,
      handler: async ({ params }) => {
        const board = await fetchBoard(
          supabaseAdmin as unknown as { from: (t: string) => any },
          params.slug,
        );
        // REST convention: a missing competition is 404, not 200/null (the web
        // server function returns null; the wire shape differs by design).
        if (!board)
          throw new ApiError({ code: "not_found", status: 404, message: "Board not found." });
        return board;
      },
    }),
  },
});
