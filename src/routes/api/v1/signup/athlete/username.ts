import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { usernameSignupResultSchema } from "@/lib/api/athlete-schema";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { signupAthleteWithUsername, usernameSignupInput } from "@/lib/athlete-signup.server";

/**
 * Thin wrapper over the shared `signupAthleteWithUsername`: an athlete
 * claims their parent's code with a username and password. The account is
 * created under a synthetic email; the app then signs in through
 * `POST /auth/password` with the username.
 */
export const Route = createFileRoute("/api/v1/signup/athlete/username")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/signup/athlete/username",
      auth: "public",
      summary: "Athlete username + password sign-up with an invite code",
      input: usernameSignupInput,
      output: usernameSignupResultSchema,
      rateLimit: { windowSeconds: 60, max: 10 },
      handler: async ({ input }) => signupAthleteWithUsername(supabaseAdmin, input),
    }),
  },
});
