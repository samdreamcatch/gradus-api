import { z } from "zod";
import type { DefineApiRouteOptions } from "@/lib/api/define-route";
import { requireContext, type ApiContext } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { WEB_HANDOFF_PATHS } from "@/lib/web-handoff-paths";
import { publicOrigin } from "./public-origin";

/**
 * `POST /api/v1/auth/web-session` — carries the app's signed-in account into
 * Safari for the pages the app hands off to (buying or managing a plan on the
 * US storefront; PRD §6.8 rule 3). Without it, "Manage your plan" landed on
 * the web's login screen instead of the paywall (TestFlight QA, 2026-09-26).
 *
 * The server mints a one-time magic-link token hash for the caller (the same
 * admin `generateLink` the auth broker and admin impersonation use; nothing is
 * emailed) and answers with `<origin>/auth/handoff#token=…&next=…`. The token
 * rides in the fragment, so it never reaches a server log; the web page
 * verifies it once (`verifyOtp`), wipes the fragment, and routes to `next`.
 * Anyone holding the caller's bearer token could already act as them, so this
 * grants nothing new; it is still rate-limited and `next` is allow-listed.
 */

export const webSessionInput = z.object({
  next: z.enum(WEB_HANDOFF_PATHS),
});

export const webSessionOutput = z.object({
  /** Open in Safari; single use, expires with Supabase's OTP lifetime. */
  url: z.string().url(),
});

export type WebSessionDeps = {
  /** The caller's email (the JWT claim first, then the auth user). */
  emailFor?: (ctx: ApiContext) => Promise<string | null>;
};

export async function defaultEmailFor(ctx: ApiContext): Promise<string | null> {
  const claim = ctx.claims?.email;
  if (typeof claim === "string" && claim) return claim;
  const { data, error } = await ctx.admin.auth.admin.getUserById(ctx.userId);
  if (error) {
    console.error("[api] web-session getUserById", error);
    return null;
  }
  return data.user?.email ?? null;
}

export function handoffUrl(origin: string, tokenHash: string, next: string): string {
  const fragment = new URLSearchParams({ token: tokenHash, next }).toString();
  return `${origin.replace(/\/$/, "")}/auth/handoff#${fragment}`;
}

export function webSessionRoute(
  deps: WebSessionDeps = {},
): DefineApiRouteOptions<z.infer<typeof webSessionInput>, z.infer<typeof webSessionOutput>> {
  const emailFor = deps.emailFor ?? defaultEmailFor;
  return {
    method: "POST",
    path: "/api/v1/auth/web-session",
    operationId: "createWebSession",
    auth: "user",
    summary: "One-time link that signs the caller into the web and opens an allow-listed page",
    input: webSessionInput,
    output: webSessionOutput,
    rateLimit: { windowSeconds: 600, max: 10 },
    handler: async ({ ctx, input, request }) => {
      const context = requireContext(ctx);
      const email = await emailFor(context);
      if (!email) {
        throw new ApiError({
          code: "no_email",
          status: 422,
          message:
            "This account signs in without an email, so open gradus.training and sign in there.",
        });
      }
      const { data, error } = await context.admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      const tokenHash = (data as unknown as { properties?: { hashed_token?: string } } | null)
        ?.properties?.hashed_token;
      if (error || !tokenHash) {
        console.error("[api] web-session generateLink", error);
        throw new ApiError({
          code: "internal",
          status: 500,
          message: "Something went wrong. Please try again.",
        });
      }
      return { url: handoffUrl(publicOrigin(request), tokenHash, input.next) };
    },
  };
}
