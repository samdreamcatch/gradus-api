import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import {
  ackCelebrationBodyInput,
  acknowledgeConnection,
  mergeAckLinkIds,
} from "@/lib/connection-celebration.server";

/**
 * Thin wrapper over the shared `acknowledgeConnection` (PRD §7.14, Appendix
 * A "Me"). `{id}` is a `coach_athletes` link id — the group's `id` from
 * `GET /me/celebrations` — and the optional body `linkIds` carries the rest
 * of the group (siblings collapse into one celebration on the web), so the
 * server acks `{id} ∪ linkIds`, scoped to what the caller owns; unowned ids
 * are silent no-ops. A caller with no role gets 403 `wrong_role`. `[idem]`:
 * naturally idempotent (a re-ack only bumps the timestamp), safe to replay
 * from the outbox.
 */
export const Route = createFileRoute("/api/v1/me/celebrations/$id/ack")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/me/celebrations/{id}/ack",
      operationId: "ackMeCelebration",
      auth: "user",
      idempotent: true,
      summary:
        "Acknowledge a connection celebration ({id} = a coach_athletes link id; body linkIds = the rest of the group)",
      // Optional: JSON bodies are declared non-required in the contract, so a
      // generated client may send none — the path id alone is a complete ack.
      input: ackCelebrationBodyInput.optional(),
      output: okSchema,
      handler: async ({ ctx, input, params }) => {
        const { admin, userId } = requireContext(ctx);
        const id = z.string().uuid().parse(params.id);
        return acknowledgeConnection(
          admin,
          userId,
          { linkIds: mergeAckLinkIds(id, input?.linkIds) },
          { apiContract: true },
        );
      },
    }),
  },
});
