import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { messageReactionSchema } from "@/lib/api/messages-schema";
import { setReaction, setReactionBody } from "@/lib/messages.server";

const outputSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), reactions: z.array(messageReactionSchema) }),
  z.object({
    ok: z.literal(false),
    reason: z.enum([
      "blocked",
      "coach_unlinked",
      "guardian_required",
      "provisional",
      "paused",
      "paused_by_parent",
      "text_only",
      "messaging_suspended",
    ]),
    message: z.string(),
  }),
]);

/**
 * Thin wrapper over the shared `setReaction` (src/lib/messages.server.ts):
 * one reaction per person per message, from the fixed five; `emoji: null`
 * clears it. Returns the message's reactions after the change. No push and
 * no unread. `ok: false` with a reason is a 200, like a refused send.
 */
export const Route = createFileRoute("/api/v1/messages/$id/reaction")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/messages/{id}/reaction",
      operationId: "setMessageReaction",
      auth: "user",
      rateLimit: { windowSeconds: 60, max: 120 },
      summary: "Set, swap, or clear your reaction on a message",
      input: setReactionBody,
      output: outputSchema,
      handler: async ({ ctx, input, params }) => {
        const messageId = z.string().uuid().parse(params.id);
        return setReaction(requireContext(ctx), messageId, input);
      },
    }),
  },
});
