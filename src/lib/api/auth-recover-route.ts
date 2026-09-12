/**
 * Route options for `POST /api/v1/auth/recover` (PRD §6.4 "Forgot password",
 * §6.10 deep links; Appendix F 3.7 in-app reset), kept out of the file route
 * so the redirect selection can be exercised with `createApiRouteHandler` and
 * a fake GoTrue client (auth-recover-route.test.ts) — the same shape as
 * `account-routes.ts`. `src/routes/api/v1/auth/recover.ts` spreads
 * `defineApiRoute(recoverRoute())`.
 *
 * The handler only ever sends one of two allow-listed constants as
 * `redirect_to` — never a caller-supplied URL — and always answers
 * `{ ok: true }` (a recovery endpoint that says "not found" is an
 * account-enumeration oracle). The email is never logged.
 */
import { z } from "zod";
import type { DefineApiRouteOptions } from "./define-route";
import { goTrueRequest } from "./gotrue";

/**
 * Same landing page the web's forgot-password flow passes as `redirectTo`:
 * /reset-password listens for the PASSWORD_RECOVERY event and shows the
 * new-password form. Without this, GoTrue falls back to the Site URL and the
 * link lands on the home page with a recovery session and nowhere to use it.
 */
export const RECOVERY_REDIRECT_URL = "https://gradus.training/reset-password";

/**
 * Custom-scheme landing for the native app (`client: "app"`): the iOS shell
 * registers `gradus://` and adopts the implicit-flow recovery session from
 * the URL fragment. GoTrue only honours a `redirect_to` that is on the
 * Supabase Auth "Redirect URLs" allow-list — until Mariah adds this exact
 * value there (Lovable Cloud, preview first), GoTrue silently falls back to
 * the Site URL, so the field is inert but harmless.
 */
export const APP_RECOVERY_REDIRECT_URL = "gradus://reset-password";

export const recoverInput = z.object({
  email: z.string().email(),
  /**
   * Which reset page the emailed link should land on. Omitted or `"web"`
   * keeps today's behaviour (the web reset page); `"app"` asks for the
   * native scheme. Optional rather than nullable: Swift either omits it or
   * sends a value.
   */
  client: z.enum(["web", "app"]).optional(),
});
export type RecoverInput = z.infer<typeof recoverInput>;

export const recoverOutput = z.object({ ok: z.literal(true) });
export type RecoverOutput = z.infer<typeof recoverOutput>;

export type RecoverRouteDeps = { goTrue: typeof goTrueRequest };

/** The only two values ever sent to GoTrue as `redirect_to`. */
export function recoveryRedirectUrl(client: RecoverInput["client"]): string {
  return client === "app" ? APP_RECOVERY_REDIRECT_URL : RECOVERY_REDIRECT_URL;
}

/**
 * Sends the recovery email through GoTrue with the service-role bearer
 * (captcha-exempt). Public, per-IP rate-limited (its only abuse control —
 * the limiter fails closed), never idempotent, response fixed at
 * `{ ok: true }` regardless of whether the email exists or what GoTrue said.
 */
export function recoverRoute(
  deps: RecoverRouteDeps = { goTrue: goTrueRequest },
): DefineApiRouteOptions<RecoverInput, RecoverOutput> {
  return {
    method: "POST",
    path: "/api/v1/auth/recover",
    auth: "public",
    summary: "Send a password-reset email",
    input: recoverInput,
    output: recoverOutput,
    rateLimit: { windowSeconds: 60, max: 10 },
    handler: async ({ input }) => {
      // Always report success regardless of whether the email exists or
      // GoTrue's own reply — a recovery endpoint that says "not found"
      // is an account-enumeration oracle.
      const redirectTo = recoveryRedirectUrl(input.client);
      await deps.goTrue(`recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
        email: input.email,
      });
      return { ok: true as const };
    },
  };
}
