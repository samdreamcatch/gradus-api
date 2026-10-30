/**
 * Coach billing summary — display only, for the `GET /api/v1/coach/billing`
 * route (PRD §6.8, Appendix A "Billing"). The app never sells: it shows the
 * coach's current entitlement, tier, and dates, and (on the US storefront
 * only, PRD §6.8 rule 3) a link to manage the plan on the web.
 *
 * Projects `getCoachProfile` (coach-onboarding.server.ts) behind a role
 * guard that never creates a coach row: `ensureCoachProfile` creates one on
 * first read for the web's onboarding flow, which a parent or athlete
 * calling this route must never trigger.
 */
import type { CoachProfileDTO } from "./coach-profile-types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { getCoachProfile, type CoachContext } from "./coach-onboarding.server";

/** The web's plan section (billing portal): update the card, cancel. */
export const BILLING_MANAGE_URL = "https://gradus.training/coach/settings";
/** The web paywall: choose or change a plan. */
export const BILLING_PAYWALL_URL = "https://gradus.training/coach/paywall";

/**
 * Where "Manage your plan" in the app should land. A coach with a live
 * Stripe subscription manages it on the settings page (portal); everyone
 * else has nothing to manage yet, so the link is the paywall (TestFlight,
 * 2026-10-28: the app's plan card sent coaches without a plan to settings).
 * The app's own "Upgrade to Coach Pro" buttons never read this: they always
 * open the paywall.
 */
export function billingManageUrl(profile: Pick<CoachProfileDTO, "entitlement" | "hasStripeCustomer" | "subscriptionStatus">): string {
  const live = ["active", "trialing", "past_due"].includes(profile.subscriptionStatus ?? "");
  return profile.entitlement === "paid" && profile.hasStripeCustomer && live ? BILLING_MANAGE_URL : BILLING_PAYWALL_URL;
}

export type CoachBillingDTO = {
  entitlement: CoachProfileDTO["entitlement"];
  effectiveTier: CoachProfileDTO["effectiveTier"];
  subscriptionTier: CoachProfileDTO["subscriptionTier"];
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  hasStripeCustomer: boolean;
  foundingCoach: boolean;
  foundingProTrialUsed: boolean;
  freeAccessUntil: string | null;
  trialNeedsCard: boolean;
  billingPastDue: boolean;
  /** null = unlimited (club). */
  athleteLimit: number | null;
  athleteCount: number;
  organizationName: string | null;
  promoLabel: string | null;
  promoPercentOff: number;
  manageUrl: string;
};

/** The billing fields of a coach profile, plus the web's manage link. */
export function toCoachBilling(profile: CoachProfileDTO): CoachBillingDTO {
  return {
    entitlement: profile.entitlement,
    effectiveTier: profile.effectiveTier,
    subscriptionTier: profile.subscriptionTier,
    subscriptionStatus: profile.subscriptionStatus,
    trialEndsAt: profile.trialEndsAt,
    currentPeriodEnd: profile.currentPeriodEnd,
    hasStripeCustomer: profile.hasStripeCustomer,
    foundingCoach: profile.foundingCoach,
    foundingProTrialUsed: profile.foundingProTrialUsed,
    freeAccessUntil: profile.freeAccessUntil,
    trialNeedsCard: profile.trialNeedsCard,
    billingPastDue: profile.billingPastDue,
    athleteLimit: profile.athleteLimit,
    athleteCount: profile.athleteCount,
    organizationName: profile.organizationName,
    promoLabel: profile.promoLabel,
    promoPercentOff: profile.promoPercentOff,
    manageUrl: billingManageUrl(profile),
  };
}

/**
 * `getCoachBilling`: the caller's billing summary. Refuses (403 `wrong_role`)
 * before touching `getCoachProfile` when the caller has no coach row, so the
 * read never creates one as a side effect.
 */
export async function getCoachBilling(ctx: CoachContext): Promise<CoachBillingDTO> {
  const coach = await ctx.supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (coach.error) dbError(coach.error);
  if (!coach.data) {
    throw new ApiError({
      code: "wrong_role",
      status: 403,
      message: "This account is not a coach.",
    });
  }
  const { profile } = await getCoachProfile(ctx);
  return toCoachBilling(profile);
}
