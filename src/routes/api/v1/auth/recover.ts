import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { goTrueRequest } from "@/lib/api/gotrue";

const inputSchema = z.object({ email: z.string().email() });

/**
 * Same landing page the web's forgot-password flow passes as `redirectTo`:
 * /reset-password listens for the PASSWORD_RECOVERY event and shows the
 * new-password form. Without this, GoTrue falls back to the Site URL and the
 * link lands on the home page with a recovery session and nowhere to use it.
 */
const RECOVERY_REDIRECT_URL = "https://gradus.training/reset-password";
const outputSchema = z.object({ ok: z.literal(true) });

export const Route = createFileRoute("/api/v1/auth/recover")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/auth/recover",
      auth: "public",
      summary: "Send a password-reset email",
      input: inputSchema,
      output: outputSchema,
      rateLimit: { windowSeconds: 60, max: 10 },
      handler: async ({ input }) => {
        // Always report success regardless of whether the email exists or
        // GoTrue's own reply — a recovery endpoint that says "not found"
        // is an account-enumeration oracle.
        await goTrueRequest(`recover?redirect_to=${encodeURIComponent(RECOVERY_REDIRECT_URL)}`, {
          email: input.email,
        });
        return { ok: true as const };
      },
    }),
  },
});
