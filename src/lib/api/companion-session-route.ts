import { z } from "zod";
import type { DefineApiRouteOptions } from "@/lib/api/define-route";
import { requireContext, type ApiContext } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { mintSessionForEmail, type MintedSession } from "@/lib/api/auth-broker";
import { defaultEmailFor } from "@/lib/api/web-session-route";

/**
 * `POST /api/v1/auth/companion` — the signed-in iPhone asks for a session of
 * its own for the paired Apple Watch (PRD §6.15, decision #36, milestone W0).
 *
 * The watch cannot borrow the phone's session: Keychain items stay on the
 * device that wrote them, and Supabase refresh tokens are single-use, so two
 * devices sharing one would sign each other out on the first refresh. The
 * server therefore mints a SECOND, independent session for the same account
 * (the same admin magic-link mint the Apple and Google sign-ins use; nothing is
 * emailed). The phone hands it to the watch over WatchConnectivity and keeps
 * nothing.
 *
 * Anyone holding the caller's bearer token could already act as them for the
 * token's life; the minted session also carries a refresh token, so a leaked
 * access token could be turned into a refreshable session (the same property
 * as `/auth/web-session` and every provider sign-in). The rate limit bounds
 * it, since each call creates a session.
 * The caller's role, pause state and consent are all enforced per route on the
 * watch's requests exactly as on the phone's, since it is the same account.
 */

export const companionSessionOutput = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});

export type CompanionSessionDeps = {
  /** The caller's email (the JWT claim first, then the auth user). */
  emailFor?: (ctx: ApiContext) => Promise<string | null>;
  mint?: (admin: ApiContext["admin"], email: string) => Promise<MintedSession>;
};

export function companionSessionRoute(
  deps: CompanionSessionDeps = {},
): DefineApiRouteOptions<undefined, z.infer<typeof companionSessionOutput>> {
  const emailFor = deps.emailFor ?? defaultEmailFor;
  const mint = deps.mint ?? ((admin, email) => mintSessionForEmail(admin, email));
  return {
    method: "POST",
    path: "/api/v1/auth/companion",
    operationId: "createCompanionSession",
    auth: "user",
    summary:
      "Mint a second, independent session for the caller's paired watch (Apple Watch or Wear OS)",
    output: companionSessionOutput,
    rateLimit: { windowSeconds: 600, max: 5 },
    handler: async ({ ctx }) => {
      const context = requireContext(ctx);
      const email = await emailFor(context);
      if (!email) {
        throw new ApiError({
          code: "no_email",
          status: 422,
          message: "This account has no email on file, so it can't sign in on a watch.",
        });
      }
      const session = await mint(context.admin, email);
      return {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: session.expiresIn,
      };
    },
  };
}
