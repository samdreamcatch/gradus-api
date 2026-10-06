import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { defineApiRoute, weakETag } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { moveLibrarySchema } from "@/lib/api/plans-schema";
import { listAthleteMoves } from "@/lib/athlete-authoring.server";

/**
 * Thin wrapper over the shared `listAthleteMoves` (PRD §6.14 C, Appendix A
 * `[etag]`): the seeded curriculum for the sports on the athlete's goals,
 * read-only, in the coach library's shape. There is no personal library.
 */
export const Route = createFileRoute("/api/v1/athlete/moves")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/athlete/moves",
      operationId: "listAthleteMoves",
      auth: "user",
      summary: "The seeded move curriculum for the athlete's sports",
      output: moveLibrarySchema,
      etag: (body) =>
        weakETag([
          "athlete-moves",
          createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16),
        ]),
      handler: async ({ ctx }) => {
        const { userId, supabase } = requireContext(ctx);
        return listAthleteMoves({ userId, supabase });
      },
    }),
  },
});
