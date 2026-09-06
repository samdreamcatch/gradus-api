import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { signupCodeValidationSchema } from "@/lib/api/signup-schema";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { validateSignupCode, validateSignupCodeInput } from "@/lib/parent-signup.server";

/** Thin wrapper over the shared `validateSignupCode`: a coach's invite or the Gradus beta code, before an account exists. */
export const Route = createFileRoute("/api/v1/signup/parent/validate-code")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/signup/parent/validate-code",
      auth: "public",
      summary: "Check a sign-up code",
      input: validateSignupCodeInput,
      output: signupCodeValidationSchema,
      rateLimit: { windowSeconds: 60, max: 30 },
      handler: async ({ input }) => validateSignupCode(supabaseAdmin, input),
    }),
  },
});
