import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { PARENT_SIGNUP_REDIRECT_URL, signUpWithPassword } from "@/lib/api/auth-broker";

const inputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const outputSchema = z.discriminatedUnion("confirmationRequired", [
  z.object({
    confirmationRequired: z.literal(false),
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresIn: z.number(),
  }),
  z.object({ confirmationRequired: z.literal(true) }),
]);

/**
 * Parent email/password sign-up (PRD §6.4, §7.1 "Parent sign-up"): the
 * account only; `POST /signup/parent/start` then creates the profile, as
 * `/signup/parent/athletes` does on the web after `supabase.auth.signUp`.
 */
export const Route = createFileRoute("/api/v1/auth/signup/parent")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/auth/signup/parent",
      auth: "public",
      summary: "Parent email/password sign-up",
      input: inputSchema,
      output: outputSchema,
      rateLimit: { windowSeconds: 60, max: 10 },
      handler: async ({ input }) => {
        const result = await signUpWithPassword(input, { redirectTo: PARENT_SIGNUP_REDIRECT_URL });
        if (result.confirmationRequired) return { confirmationRequired: true as const };
        return {
          confirmationRequired: false as const,
          accessToken: result.session.accessToken,
          refreshToken: result.session.refreshToken,
          expiresIn: result.session.expiresIn,
        };
      },
    }),
  },
});
