import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { getAiConsent, setAiConsent } from "@/lib/ai-consent.server";

const consentSchema = z.object({
  /** `unasked` until the account answers the current version of the screen. */
  state: z.enum(["granted", "declined", "unasked"]),
  version: z.string(),
  decidedAt: z.string().nullable(),
});

const inputSchema = z.object({ granted: z.boolean() });

/**
 * The account's answer to the AI permission screen (App Review 5.1.2(i);
 * src/lib/ai-consent.server.ts). The app asks during setup and from
 * Settings → AI features; every AI route refuses with 403
 * `ai_consent_required` until the answer is `granted`.
 */
export const Route = createFileRoute("/api/v1/me/ai-consent")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/me/ai-consent",
        operationId: "getMeAiConsent",
        auth: "user",
        summary: "The caller's answer to the AI permission screen",
        output: consentSchema,
        handler: async ({ ctx }) => {
          const { admin, userId } = requireContext(ctx);
          return getAiConsent(admin, userId);
        },
      }),
      ...defineApiRoute({
        method: "PUT",
        path: "/api/v1/me/ai-consent",
        operationId: "putMeAiConsent",
        auth: "user",
        summary: "Allow or decline AI features for the caller",
        input: inputSchema,
        output: consentSchema,
        handler: async ({ ctx, input }) => {
          const { admin, userId } = requireContext(ctx);
          return setAiConsent(admin, userId, input.granted);
        },
      }),
    },
  },
});
