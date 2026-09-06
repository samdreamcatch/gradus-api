import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { defineApiRoute, weakETag } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { moveLibrarySchema, upsertMoveResultSchema } from "@/lib/api/plans-schema";
import { listMoves, moveInput, upsertMove } from "@/lib/moves.server";
import { requirePlansCoach } from "@/lib/plan-detail.server";

/**
 * Thin wrappers over the shared `listMoves` and `upsertMove` (PRD §7.3
 * "Move library", Appendix A `[etag]`): the coach's live moves with the
 * seeded curriculum categories, and create-or-update with the same-name
 * check (`ok: false` carries the conflict; `overwriteMoveId` resolves it).
 */
export const Route = createFileRoute("/api/v1/coach/moves/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/coach/moves",
        operationId: "listMoves",
        auth: "user",
        summary: "The coach's move library",
        output: moveLibrarySchema,
        etag: (body) =>
          weakETag([
            "moves",
            createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16),
          ]),
        handler: async ({ ctx }) => listMoves(await requirePlansCoach(requireContext(ctx))),
      }),
      ...defineApiRoute({
        method: "PUT",
        path: "/api/v1/coach/moves",
        operationId: "upsertMove",
        auth: "user",
        summary: "Create or update a library move",
        input: moveInput,
        output: upsertMoveResultSchema,
        handler: async ({ ctx, input }) =>
          upsertMove(await requirePlansCoach(requireContext(ctx)), input),
      }),
    },
  },
});
