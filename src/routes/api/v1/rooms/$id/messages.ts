import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { getAiConsent } from "@/lib/ai-consent.server";
import { sendMessage, sendMessageBody, type sendMessageInputWithRole } from "@/lib/messages.server";

const outputSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), id: z.string() }),
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
    ]),
    message: z.string(),
  }),
]);

/**
 * Thin wrapper over the shared `sendMessage` (src/lib/messages.server.ts).
 * `[idem]`: send `Idempotency-Key` so an offline retry never double-posts.
 * A voice note is either inline (`audioBase64`) or an object the client
 * uploaded itself to `voice-notes/<roomId>/<userId>/<uuid>.<ext>`
 * (`audioPath`; the bucket's RLS admits room participants). `ok: false`
 * with a reason is a 200, like the web: the thread stays readable.
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
        // No transcript without the sender's AI permission (App Review 5.1.2(i)).
        const transcribe =
          data.kind === "voice" ? (await getAiConsent(admin, userId)).state === "granted" : true;
        return sendMessage({ userId }, data, { transcribe });
      },
    }),
  },
});
