/**
 * Shared handling for a coach leaving — or being removed from — a club plan.
 *
 * A coach who loses their club seat should never be locked out mid-season, so
 * they get a 90-day free window (entitlement `promo_free` + `free_access_until`)
 * and the WELCOME_BACK promo attached to their profile, which the paywall
 * auto-applies if they choose to upgrade.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const CLUB_EXIT_FREE_DAYS = 90;

type AdminClient = SupabaseClient<Database>;

export function clubExitFreeUntil(from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + CLUB_EXIT_FREE_DAYS);
  return d.toISOString();
}

/**
 * Detach the coach from their club and grant the 90-day free window.
 * Requires the service-role client — billing columns are DB-locked.
 */
export async function applyClubExitGrace(
  admin: AdminClient,
  coachId: string,
  opts: { existingPromoCode?: string | null; hasStripeCustomer?: boolean } = {},
): Promise<{ freeUntil: string; welcomeBackGranted: boolean }> {
  const freeUntil = clubExitFreeUntil();

  // Only stash WELCOME_BACK when the coach has no promo of their own.
  let grantWelcomeBack = false;
  if (!opts.existingPromoCode) {
    const { data: promo } = await admin
      .from("promo_codes")
      .select("code, active")
      .eq("code", "WELCOME_BACK")
      .maybeSingle();
    grantWelcomeBack = Boolean(promo?.active);
  }

  const { error } = await admin
    .from("coach_profiles")
    .update({
      organization_id: null,
      entitlement: "promo_free",
      free_access_until: freeUntil,
      ...(grantWelcomeBack ? { promo_code: "WELCOME_BACK" } : {}),
    })
    .eq("id", coachId);
  if (error) throw error;

  return { freeUntil, welcomeBackGranted: grantWelcomeBack };
}
