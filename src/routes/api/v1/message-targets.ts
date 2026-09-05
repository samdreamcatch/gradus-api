import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { messageTargetSchema } from "@/lib/api/messages-schema";
import { listMessageTargets } from "@/lib/messages.server";

const outputSchema = z.object({ targets: z.array(messageTargetSchema) });

/** Thin wrapper over the shared `listMessageTargets` (src/lib/messages.server.ts). */
export const Route = createFileRoute("/api/v1/message-targets")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/message-targets",
      auth: "user",
      summary: "Who the caller can start a conversation with (new-conversation picker)",
      output: outputSchema,
      handler: async ({ ctx }) => listMessageTargets({ userId: requireContext(ctx).userId }),
    }),
  },
});
