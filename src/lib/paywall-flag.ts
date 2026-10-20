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
export const FOUNDING_COACH_CUTOFF = new Date("2026-12-01T00:00:00Z");

/** Free Coach Pro trial length for founding coaches (3 months). */
export const FOUNDING_PRO_TRIAL_MONTHS = 3;
export const FOUNDING_PRO_TRIAL_DAYS = 90;

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
 * Cap on primary sports (Strength & Conditioning is always exempt and never
 * counts toward the cap — the SportMultiselect enforces that via
 * `alwaysAllowedSecondary`).
 *
 * Rule:
 * - Coach Pro / Club: unlimited.
 * - Basic Coach: 1 primary sport.
 * - Grandfather clause: founding coaches who already have >1 saved primary
 *   sport (again, excluding S&C) keep unlimited — their existing multi-sport
 *   setup shouldn't break when the Coach / Coach Pro distinction ships. New
 *   founding coaches with 0 or 1 saved primary sport get the normal cap.
 */
export function maxPrimarySportsForCoach(profile: {
  effectiveTier: "coach" | "coach_pro" | "club";
  foundingCoach: boolean;
  /** Distinct primary sports already saved (excluding S&C). */
  distinctPrimarySportCount: number;
}): number | undefined {
  if (profile.effectiveTier !== "coach") return undefined;
  if (profile.foundingCoach && profile.distinctPrimarySportCount > 1) return undefined;
  return 1;
}
