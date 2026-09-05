import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { ApiError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  exchangeAppleAuthorizationCode,
  findOrCreateIdentityUser,
  getUserEmail,
  mintSessionForEmail,
  storeAppleRefreshToken,
} from "@/lib/api/auth-broker";
import { verifyAppleIdentityToken } from "@/lib/api/provider-verify";

const inputSchema = z.object({
  identityToken: z.string().min(1),
  nonce: z.string().min(1),
  // Apple sends the user's name ONLY on the very first authorization; the
  // client forwards it here and we keep it in user_metadata at account
  // creation so onboarding can prefill it. It is never used to match an
  // existing account.
  fullName: z
    .object({ givenName: z.string().optional(), familyName: z.string().optional() })
    .optional(),
  // Optional: ASAuthorizationAppleIDCredential.authorizationCode. When
  // present (and the Apple key secrets are configured), it's exchanged for
  // Apple's own refresh token so account deletion can later revoke this
  // app's grant. Sign-in succeeds either way.
  authorizationCode: z.string().optional(),
});

const outputSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
  isNewUser: z.boolean(),
});

export const Route = createFileRoute("/api/v1/auth/apple")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/auth/apple",
      auth: "public",
      summary: "Sign in with Apple",
      input: inputSchema,
      output: outputSchema,
      rateLimit: { windowSeconds: 60, max: 20 },
      handler: async ({ input }) => {
        const identity = await verifyAppleIdentityToken(input.identityToken, input.nonce);

        const { userId, isNewUser } = await findOrCreateIdentityUser(supabaseAdmin, {
          provider: "apple",
          providerSub: identity.sub,
          email: identity.email,
          emailVerified: identity.emailVerified,
          name: input.fullName ?? null,
        });

        if (input.authorizationCode) {
          const refreshToken = await exchangeAppleAuthorizationCode(input.authorizationCode);
          if (refreshToken) await storeAppleRefreshToken(supabaseAdmin, identity.sub, refreshToken);
        }

        const email = await getUserEmail(supabaseAdmin, userId);
        if (!email) {
          throw new ApiError({
            code: "account_email_missing",
            status: 409,
            message: "This account has no email on file to sign in with.",
          });
        }
        const session = await mintSessionForEmail(supabaseAdmin, email);

        return {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresIn: session.expiresIn,
          isNewUser,
        };
      },
    }),
  },
});
