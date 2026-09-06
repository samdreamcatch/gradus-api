import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { reportInput } from "@/lib/safety-types";
import { submitReport } from "@/lib/safety.server";

const outputSchema = z.object({ ok: z.literal(true), blocked: z.boolean() });

/**
 * Thin wrapper over the shared `submitReport` (src/lib/safety.server.ts).
 * `[idem]` so a retried report is not filed twice; rate-limited because it
 * emails the safety inbox. Report and block are one tap away on every room
 * (PRD §6.11, App Store 1.2).
 */
export const Route = createFileRoute("/api/v1/safety/reports")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/safety/reports",
      auth: "user",
      idempotent: true,
      rateLimit: { windowSeconds: 3600, max: 20 },
      summary: "Report a person, a message, or a resource (optionally blocking)",
      input: reportInput,
      output: outputSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin, supabase } = requireContext(ctx);
        return submitReport({ userId, admin, supabase }, input);
      },
    }),
  },
});
