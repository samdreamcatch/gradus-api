import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { ADULT_ATHLETE_SIGNUP_REDIRECT_URL, signUpWithPassword } from "@/lib/api/auth-broker";

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
 * Adult (self-managed) athlete email/password sign-up (PRD §7.1 "Adult
 * athlete sign-up"): the account only; `POST /signup/adult-athlete` then
 * creates the athlete, as `/signup/athlete/adult` does on the web.
 */
export const Route = createFileRoute("/api/v1/auth/signup/adult-athlete")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/auth/signup/adult-athlete",
      auth: "public",
      summary: "Adult athlete email/password sign-up",
      input: inputSchema,
      output: outputSchema,
      rateLimit: { windowSeconds: 60, max: 10 },
      handler: async ({ input }) => {
        const result = await signUpWithPassword(input, {
          redirectTo: ADULT_ATHLETE_SIGNUP_REDIRECT_URL,
        });
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
