/**
 * Coach paywall kill-switch.
 *
 * While `VITE_COACH_PAYWALL_ENABLED` is not `"true"`, new coach signups are
 * auto-stamped as "Founding Coach" (lifetime-free, entitlement=promo_free).
 *
 * Flipping the flag to true restores the pricing UI for future signups.
 * Founding coaches stay free forever because access is decided by
 * `entitlement` + `founding_coach`, not by the flag.
 *
 * Vite inlines `import.meta.env.VITE_*` in both the client and worker SSR
 * bundles, so this helper works in components, loaders, and server-fn handlers.
 */

/** Legacy promo code used before the `founding_coach` column existed. Kept
 *  so old rows still recognize as founding for one release. */
export const FOUNDING_COACH_PROMO_CODE = "FOUNDING_COACH";

/** Any coach who onboards before this date is auto-granted Founding Coach. */
export const FOUNDING_COACH_CUTOFF = new Date("2026-09-01T00:00:00Z");

export function isFoundingCoachWindowOpen(now: Date = new Date()): boolean {
  return now < FOUNDING_COACH_CUTOFF;
}

export function isCoachPaywallEnabled(): boolean {
  return import.meta.env.VITE_COACH_PAYWALL_ENABLED === "true";
}

/**
 * Coach Pro availability flag. While false, the "Upgrade to Coach Pro"
 * affordance in settings is shown in a disabled "Coming soon" state.
 */
export function isCoachProAvailable(): boolean {
  return import.meta.env.VITE_COACH_PRO_ENABLED === "true";
}

/**
 * Cap on primary sports (Strength & Conditioning is always exempt).
 * Founding coaches are grandfathered into unlimited sports even on the
 * basic Coach tier, so their existing multi-sport setups keep working
 * when the Coach / Coach Pro distinction ships.
 */
export function maxPrimarySportsForCoach(profile: {
  effectiveTier: "coach" | "coach_pro" | "club";
  foundingCoach: boolean;
}): number | undefined {
  if (profile.foundingCoach) return undefined;
  return profile.effectiveTier === "coach" ? 1 : undefined;
}
