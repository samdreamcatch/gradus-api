import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute, type DefineApiRouteOptions } from "@/lib/api/define-route";
import { ApiError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { resolveSignInEmail } from "@/lib/api/auth-broker";
import { goTrueRequest } from "@/lib/api/gotrue";
import { hashClientData, logAppAttestAssertion } from "@/lib/app-attest.server";

const inputSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

const outputSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});

type PasswordSignInInput = z.infer<typeof inputSchema>;
type PasswordSignInOutput = z.infer<typeof outputSchema>;

const INVALID_CREDENTIALS = new ApiError({
  code: "invalid_credentials",
  status: 401,
  message: "Incorrect email/username or password.",
});

/**
 * Route options, extracted into a function (rather than written inline in
 * `Route`) so the App Attest log-only addition below can be exercised with
 * `createApiRouteHandler` and injected fake deps, the same way
 * account-routes.ts's `deleteMyAccountRoute` is tested — see
 * password.test.ts's "never enforcing" test, which asserts the response is
 * byte-identical whether the attest headers are absent, valid, or garbage.
 * Behavior is otherwise unchanged from before this extraction.
 */
export function passwordRouteOptions(): DefineApiRouteOptions<
  PasswordSignInInput,
  PasswordSignInOutput
> {
  return {
    method: "POST",
    path: "/api/v1/auth/password",
    auth: "public",
    summary: "Sign in with email/username and password",
    input: inputSchema,
    output: outputSchema,
    // IP-wide guard on top of the per-identifier one below (PRD §6.4:
    // "Rate-limited per IP and per identifier").
    rateLimit: { windowSeconds: 60, max: 20 },
    handler: async ({ input, request }) => {
      const identifierKey = input.identifier.trim().toLowerCase();
      const identifierLimit = await checkRateLimit(
        supabaseAdmin,
        { windowSeconds: 60, max: 10 },
        { route: "/api/v1/auth/password", ip: null, extra: identifierKey },
      );
      if (!identifierLimit.allowed) {
        throw ApiError.rateLimited(identifierLimit.retryAfterSeconds);
      }
      if (identifierLimit.degraded) throw ApiError.limiterUnavailable();

      // App Attest, log-only (docs/ios/PRD.md §3.8, I15): dormant this
      // wave. Its outcome is never read by anything below — the response
      // and status code this route returns are identical whether these
      // headers are absent, valid, or garbage; see
      // src/lib/app-attest.server.ts and this route's "never enforcing"
      // test. Wrapped in try/catch as defense in depth even though
      // logAppAttestAssertion never throws on its own.
      const attestKeyId = request.headers.get("x-gradus-attest-key-id");
      const attestAssertion = request.headers.get("x-gradus-attest-assertion");
      try {
        if (attestKeyId && attestAssertion) {
          const clientDataHash = hashClientData(new TextEncoder().encode(JSON.stringify(input)));
          const outcome = await logAppAttestAssertion(supabaseAdmin, {
            keyId: attestKeyId,
            assertionB64: attestAssertion,
            clientDataHash,
          });
          console.log("[app-attest] password sign-in", JSON.stringify({ present: true, outcome }));
        } else {
          console.log("[app-attest] password sign-in", JSON.stringify({ present: false }));
        }
      } catch (err) {
        console.error(
          "[app-attest] password sign-in check threw",
          err instanceof Error ? err.message : err,
        );
      }

      const viaUsername = !input.identifier.includes("@");
      const email = await resolveSignInEmail(supabaseAdmin, input.identifier);
      if (!email) {
        // Server-side only; the client always gets the generic 401.
        console.warn("[api] password grant: unknown username");
        throw INVALID_CREDENTIALS;
      }

      const result = await goTrueRequest<{
        access_token: string;
        refresh_token: string;
        expires_in: number;
      }>("token?grant_type=password", { email, password: input.password });

      if (!result.ok || !result.data) {
        // Server-side only, no identifiers: lets Lovable's logs distinguish a
        // wrong password from a rejected grant (captcha, unconfirmed email,
        // disabled provider) without weakening the generic client error.
        console.warn(
          "[api] password grant rejected",
          JSON.stringify({
            status: result.status,
            code: result.error?.error_code ?? result.error?.error ?? null,
            message: result.error?.msg ?? result.error?.error_description ?? null,
            viaUsername,
          }),
        );
        throw INVALID_CREDENTIALS;
      }

      return {
        accessToken: result.data.access_token,
        refreshToken: result.data.refresh_token,
        expiresIn: result.data.expires_in,
      };
    },
  };
}

export const Route = createFileRoute("/api/v1/auth/password")({
  server: {
    handlers: defineApiRoute(passwordRouteOptions()),
  },
});
