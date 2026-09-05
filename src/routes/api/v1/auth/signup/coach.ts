import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { signUpCoachWithPassword } from "@/lib/api/auth-broker";

const inputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  // Accepted per the PRD §6.4 contract, not yet applied: promo/invite
  // codes are claimed against a coach *profile*, which doesn't exist until
  // the first onboarding call — that claim flow lives with the B3 sign-up
  // and onboarding endpoints, not here.
  promoCode: z.string().optional(),
  inviteCode: z.string().optional(),
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

export const Route = createFileRoute("/api/v1/auth/signup/coach")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/auth/signup/coach",
      auth: "public",
      summary: "Coach email/password sign-up",
      input: inputSchema,
      output: outputSchema,
      rateLimit: { windowSeconds: 60, max: 10 },
      handler: async ({ input }) => {
        // Same GoTrue /signup call the web makes, so the project's own
        // confirmation setting decides whether a session comes back.
        const result = await signUpCoachWithPassword({
          email: input.email,
          password: input.password,
        });
        if (result.confirmationRequired) {
          return { confirmationRequired: true as const };
        }
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
