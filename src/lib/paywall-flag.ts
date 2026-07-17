/**
 * Coach paywall kill-switch.
 *
 * While `VITE_COACH_PAYWALL_ENABLED` is not `"true"`, new coach signups are
 * auto-stamped as "Founding Coach" (lifetime-free, entitlement=promo_free,
 * promo_code=FOUNDING_COACH) and the paywall route redirects to /coach/roster.
 *
 * Flipping the flag to true restores the pricing UI for future signups.
 * Founding coaches stay free forever because access is decided by
 * `entitlement`, not by the flag.
 *
 * Vite inlines `import.meta.env.VITE_*` in both the client and worker SSR
 * bundles, so this helper works in components, loaders, and server-fn handlers.
 */
export const FOUNDING_COACH_PROMO_CODE = "FOUNDING_COACH";

export function isCoachPaywallEnabled(): boolean {
  return import.meta.env.VITE_COACH_PAYWALL_ENABLED === "true";
}
