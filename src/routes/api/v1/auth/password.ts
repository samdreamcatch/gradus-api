import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { ApiError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { resolveSignInEmail } from "@/lib/api/auth-broker";
import { goTrueRequest } from "@/lib/api/gotrue";

const inputSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

const outputSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});

const INVALID_CREDENTIALS = new ApiError({
  code: "invalid_credentials",
  status: 401,
  message: "Incorrect email/username or password.",
});

export const Route = createFileRoute("/api/v1/auth/password")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/auth/password",
      auth: "public",
      summary: "Sign in with email/username and password",
      input: inputSchema,
      output: outputSchema,
      // IP-wide guard on top of the per-identifier one below (PRD §6.4:
      // "Rate-limited per IP and per identifier").
      rateLimit: { windowSeconds: 60, max: 20 },
      handler: async ({ input }) => {
        const identifierKey = input.identifier.trim().toLowerCase();
        const identifierLimit = await checkRateLimit(
          supabaseAdmin,
          { windowSeconds: 60, max: 10 },
          { route: "/api/v1/auth/password", ip: null, extra: identifierKey },
        );
        if (!identifierLimit.allowed) {
          throw ApiError.rateLimited(identifierLimit.retryAfterSeconds);
        }

        const email = await resolveSignInEmail(supabaseAdmin, input.identifier);
        if (!email) throw INVALID_CREDENTIALS;

        const result = await goTrueRequest<{
          access_token: string;
          refresh_token: string;
          expires_in: number;
        }>("token?grant_type=password", { email, password: input.password });

        if (!result.ok || !result.data) throw INVALID_CREDENTIALS;

        return {
          accessToken: result.data.access_token,
          refreshToken: result.data.refresh_token,
          expiresIn: result.data.expires_in,
        };
      },
    }),
  },
});
