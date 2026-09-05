import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { findOrCreateIdentityUser, getUserEmail, mintSessionForEmail } from "@/lib/api/auth-broker";
import { verifyGoogleIdToken } from "@/lib/api/provider-verify";

const inputSchema = z.object({ idToken: z.string().min(1) });

const outputSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
  isNewUser: z.boolean(),
});

export const Route = createFileRoute("/api/v1/auth/google")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/auth/google",
      auth: "public",
      summary: "Sign in with Google",
      input: inputSchema,
      output: outputSchema,
      rateLimit: { windowSeconds: 60, max: 20 },
      handler: async ({ input }) => {
        const identity = await verifyGoogleIdToken(input.idToken);

        const { userId, isNewUser } = await findOrCreateIdentityUser(supabaseAdmin, {
          provider: "google",
          providerSub: identity.sub,
          email: identity.email,
        });

        const email = await getUserEmail(supabaseAdmin, userId);
        if (!email) {
          throw new Error("This account has no email on file to sign in with.");
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
