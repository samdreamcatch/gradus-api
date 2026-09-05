import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { ApiError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { goTrueRequest } from "@/lib/api/gotrue";

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
        // email_confirm left false so the account is subject to whatever
        // this Supabase project's own "Confirm email" setting already is —
        // same as the web's `supabase.auth.signUp`. We don't force either
        // way because that setting isn't readable from this repo (see the
        // B2 PR description).
        const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: input.email,
          password: input.password,
          email_confirm: false,
        });
        if (createError || !created?.user) {
          throw new ApiError({
            code: "signup_failed",
            status: 409,
            message: createError?.message ?? "Could not create this account.",
          });
        }

        // Mirror `supabase.auth.signUp`'s behavior: if the project doesn't
        // require confirmation, signing up also signs the user in.
        const signInResult = await goTrueRequest<{
          access_token: string;
          refresh_token: string;
          expires_in: number;
        }>("token?grant_type=password", { email: input.email, password: input.password });

        if (!signInResult.ok || !signInResult.data) {
          return { confirmationRequired: true as const };
        }

        return {
          confirmationRequired: false as const,
          accessToken: signInResult.data.access_token,
          refreshToken: signInResult.data.refresh_token,
          expiresIn: signInResult.data.expires_in,
        };
      },
    }),
  },
});
