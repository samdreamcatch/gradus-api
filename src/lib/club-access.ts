import type { CoachEffectiveTier, CoachEntitlement } from "./coach-profile-types";

export function effectiveCoachEntitlement(input: {
  entitlement: CoachEntitlement;
  tier: CoachEffectiveTier;
  foundingCoach: boolean;
  subscriptionStatus: string | null;
}): CoachEntitlement {
  if (input.entitlement !== "club_covered" || input.tier === "club") return input.entitlement;
  if (input.foundingCoach) return "promo_free";
  return ["active", "trialing"].includes(input.subscriptionStatus ?? "") ? "paid" : "pending";
}