/**
 * Route options for `POST /api/v1/auth/signup/coach` (PRD §6.4, §7.1 "Coach
 * sign-up"), kept out of the file route so the sign-up and the profile step
 * can be exercised with `createApiRouteHandler` and fakes
 * (coach-signup-route.test.ts), the same shape as `auth-recover-route.ts`.
 * `src/routes/api/v1/auth/signup/coach.ts` spreads
 * `defineApiRoute(coachSignupRoute())`.
 *
 * Once GoTrue returns a session, the coach profile row and the Terms
 * acceptance are recorded right away (2026-10-20), so the account's role
 * is already `coach` the first time the app reads `GET /me`. Before this,
 * the row only appeared on the first `GET /coach/profile`, and iOS build
 * 101 could lose track of the role once onboarding finished. Its post-
 * onboarding `/me` refresh is cancelled when the onboarding screen closes,
 * so a coach saw the "Who are you joining Gradus as?" chooser and the
 * Terms toggle a second time. With the row in place from sign-up, the
 * cached `/me` already says coach and the app goes straight to the tabs.
 */
import { z } from "zod";
import type { DefineApiRouteOptions } from "./define-route";
import { authenticateRequest, type ApiContext } from "./auth";
import { signUpCoachWithPassword } from "./auth-broker";
import { coachContext, ensureCoachProfile } from "../coach-onboarding.server";
import { CURRENT_TERMS_VERSION } from "../terms";

export const coachSignupInput = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  // Accepted per the PRD §6.4 contract, not yet applied: promo/invite codes
  // are claimed in onboarding (the app sends them after sign-up).
  promoCode: z.string().optional(),
  inviteCode: z.string().optional(),
});
export type CoachSignupInput = z.infer<typeof coachSignupInput>;

export const coachSignupOutput = z.discriminatedUnion("confirmationRequired", [
  z.object({
    confirmationRequired: z.literal(false),
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresIn: z.number(),
  }),
  z.object({ confirmationRequired: z.literal(true) }),
]);
export type CoachSignupOutput = z.infer<typeof coachSignupOutput>;

export type CoachSignupRouteDeps = {
  signUp: typeof signUpCoachWithPassword;
  /** Builds the new coach's own request context from the minted access token. */
  contextFor: (accessToken: string) => Promise<ApiContext | null>;
  ensureProfile: (ctx: ApiContext) => Promise<unknown>;
};

const defaultDeps: CoachSignupRouteDeps = {
  signUp: signUpCoachWithPassword,
  contextFor: (accessToken) =>
    authenticateRequest(
      new Request("https://gradus.training/api/v1/auth/signup/coach", {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    ),
  ensureProfile: (ctx) => ensureCoachProfile(coachContext(ctx)),
};

/**
 * Creates the coach row (seeded from the token's name metadata, as on first
 * sight) and records the current Terms. The app's sign-up form can't be
 * submitted without the Terms toggle (iOS `SignUpModel.canSubmit`), and the
 * web likewise records its form's agreement once a profile exists
 * (`stashPendingTermsAccept`). Written through the caller's own client, so
 * RLS applies exactly as in `POST /me/terms/accept`.
 *
 * Never fails the sign-up: the account already exists at this point, and a
 * retry would hit "already registered". If either step fails, the app's own
 * onboarding does both later, as it did before this change.
 */
export async function provisionCoachAtSignup(
  accessToken: string,
  deps: Pick<CoachSignupRouteDeps, "contextFor" | "ensureProfile"> = defaultDeps,
): Promise<void> {
  let ctx: ApiContext | null;
  try {
    ctx = await deps.contextFor(accessToken);
  } catch (err) {
    console.error("[api] signup/coach provision: token", err);
    return;
  }
  if (!ctx) return;
  try {
    await deps.ensureProfile(ctx);
  } catch (err) {
    console.error("[api] signup/coach provision: profile", err);
    return;
  }
  try {
    const { error } = await ctx.supabase
      .from("terms_acceptances")
      .upsert(
        { user_id: ctx.userId, role: "coach", terms_version: CURRENT_TERMS_VERSION },
        { onConflict: "user_id,terms_version", ignoreDuplicates: true },
      );
    if (error) console.error("[api] signup/coach provision: terms", error);
  } catch (err) {
    console.error("[api] signup/coach provision: terms", err);
  }
}

export function coachSignupRoute(
  deps: CoachSignupRouteDeps = defaultDeps,
): DefineApiRouteOptions<CoachSignupInput, CoachSignupOutput> {
  return {
    method: "POST",
    path: "/api/v1/auth/signup/coach",
    auth: "public",
    summary: "Coach email/password sign-up",
    input: coachSignupInput,
    output: coachSignupOutput,
    rateLimit: { windowSeconds: 60, max: 10 },
    handler: async ({ input }) => {
      // Same GoTrue /signup call the web makes, so the project's own
      // confirmation setting decides whether a session comes back.
      const result = await deps.signUp({ email: input.email, password: input.password });
      if (result.confirmationRequired) {
        // No session, so nothing to provision; onboarding creates the row after confirmation.
        return { confirmationRequired: true as const };
      }
      await provisionCoachAtSignup(result.session.accessToken, deps);
      return {
        confirmationRequired: false as const,
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken,
        expiresIn: result.session.expiresIn,
      };
    },
  };
}
