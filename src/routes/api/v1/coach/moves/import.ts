import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { importMovesResultSchema } from "@/lib/api/plans-schema";
import { importMoves, importMovesInput } from "@/lib/moves.server";
import { requirePlansCoach } from "@/lib/plan-detail.server";

/**
 * Thin wrapper over the shared `importMoves`: the iOS move-library .csv
 * import (Mariah 2026-10-12; no web button yet). Up to 500 rows; a name
 * already in the library is skipped unless that row asks to overwrite.
 * Idempotent, since a replayed import would otherwise report every row as
 * a name conflict with itself.
 */
export const Route = createFileRoute("/api/v1/coach/moves/import")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/moves/import",
      operationId: "importMoves",
      auth: "user",
      idempotent: true,
      summary: "Add many moves to the library at once",
      input: importMovesInput,
      output: importMovesResultSchema,
      handler: async ({ ctx, input }) =>
        importMoves(await requirePlansCoach(requireContext(ctx)), input),
    }),
  },
});
