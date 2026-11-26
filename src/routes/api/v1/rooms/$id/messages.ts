import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { getAiConsent } from "@/lib/ai-consent.server";
import { sendMessage, sendMessageBody, type sendMessageInputWithRole } from "@/lib/messages.server";

const outputSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    id: z.string(),
    /** Present and true when the sender should be shown the 988 line (PRD #64). */
    crisisLine: z.literal(true).optional(),
  }),
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
      "content_blocked",
    ]),
    message: z.string(),
    /** `content_blocked` only: resending with `sendAnyway: true` will deliver it. */
    canSendAnyway: z.boolean().optional(),
    /** `content_blocked` only: the sender is under 18, so link the Safe Sport panel. */
    showSafeSport: z.boolean().optional(),
  }),
]);

/**
 * Thin wrapper over the shared `sendMessage` (src/lib/messages.server.ts).
 * `[idem]`: send `Idempotency-Key` so an offline retry never double-posts.
 * A voice note is either inline (`audioBase64`) or an object the client
 * uploaded itself to `voice-notes/<roomId>/<userId>/<uuid>.<ext>`
 * (`audioPath`; the bucket's RLS admits room participants). `ok: false`
 * with a reason is a 200, like the web: the thread stays readable.
 * `content_blocked` (PRD #64): the message check held the text; keep it in
 * the composer, show `message`, and offer "Send anyway" only when
 * `canSendAnyway` is true (resend the same body with `sendAnyway: true`).
 */
export const Route = createFileRoute("/api/v1/rooms/$id/messages")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/rooms/{id}/messages",
      auth: "user",
      idempotent: true,
      rateLimit: { windowSeconds: 60, max: 60 },
      summary: "Send a text or voice message",
      input: sendMessageBody,
      output: outputSchema,
      handler: async ({ ctx, input, params }) => {
        const roomId = z.string().uuid().parse(params.id);
        const data = { ...input, roomId } as z.infer<typeof sendMessageInputWithRole>;
        const { admin, userId } = requireContext(ctx);
        // No server transcript without the sender's AI permission (App Review
        // 5.1.2(i)); a transcript made on the sender's device needs none.
        const transcribe =
          data.kind === "voice" && data.transcript === undefined
            ? (await getAiConsent(admin, userId)).state === "granted"
            : true;
        return sendMessage({ userId }, data, { transcribe });
      },
    }),
  },
});
