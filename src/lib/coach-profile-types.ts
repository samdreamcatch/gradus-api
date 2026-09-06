/**
 * Browser-safe coach profile types and pure helpers, shared by the web
 * hooks, the server functions, and the `/api/v1/coach/*` routes.
 */

export type CoachEntitlement = "pending" | "club_covered" | "paid" | "promo_free";

export type CoachEffectiveTier = "coach" | "coach_pro" | "club";

export interface CoachProfileDTO {
  id: string;
  firstName: string;
  lastName: string;
  onboardedAt: string | null;
  entitlement: CoachEntitlement;
  organizationId: string | null;
  organizationName: string | null;
  subscriptionTier: "coach" | "coach_pro" | null;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  hasStripeCustomer: boolean;
  promoCode: string | null;
  promoLabel: string | null;
  promoPercentOff: number;
  effectiveTier: CoachEffectiveTier;
  /** null = unlimited (club). */
  athleteLimit: number | null;
  athleteCount: number;
  foundingCoach: boolean;
  foundingProTrialUsed: boolean;
  /**
   * When set, complimentary access ends on this date — currently only used
   * for the 90-day window after a coach leaves or is removed from a club.
   * Null means the free access has no end date (e.g. Founding Coach).
   */
  freeAccessUntil: string | null;
  /**
   * True when the coach is mid-trial on Stripe with no payment method on
   * file — legacy card-free trials started before cards became mandatory.
   * Drives the "add a card" nudge; never revokes access.
   */
  trialNeedsCard: boolean;
  /** Stripe environment the stored subscription belongs to ("sandbox" | "live"). */
  subscriptionEnvironment: "sandbox" | "live" | null;
  /**
   * True only when Stripe itself confirms the subscription is past_due /
   * unpaid right now, and the coach actually owes money. Stale rows, test
   * mode leftovers, and free (founding / club-covered) coaches never set it.
   */
  billingPastDue: boolean;
}

export interface CoachLevelDTO {
  sport: string;
  levelKey: string;
  hoursPerWeek: number;
}

/** Mirrors public.coach_effective_tier() in the DB — DB is authoritative. */
export function computeEffectiveTier(input: {
  organizationId: string | null;
  subscriptionTier: "coach" | "coach_pro" | null;
}): CoachEffectiveTier {
  if (input.organizationId) return "club";
  if (input.subscriptionTier === "coach_pro") return "coach_pro";
  return "coach";
}

export function athleteLimitForTier(tier: CoachEffectiveTier): number | null {
  if (tier === "club") return null;
  if (tier === "coach_pro") return 50;
  return 5;
}
