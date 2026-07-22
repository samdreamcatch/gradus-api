import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { StripeEnv } from "@/lib/stripe.server";

type AdminClient = SupabaseClient<Database>;

const PRICE_TIER: Record<string, "coach" | "coach_pro"> = {
  coach_monthly: "coach",
  coach_yearly: "coach",
  coach_pro_monthly: "coach_pro",
  coach_pro_yearly: "coach_pro",
};

function isActive(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

/**
 * Idempotent sync of a Stripe Subscription onto public.coach_profiles.
 * Shared by the Stripe webhook and the synchronous verify-checkout server
 * function so both code paths arrive at the same profile state.
 *
 * Requires a Supabase client with permission to update coach_profiles
 * for the target user (service-role admin client).
 */
export async function syncCoachSubscription(
  supabase: AdminClient,
  subscription: any,
  env: StripeEnv,
): Promise<void> {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.error("syncCoachSubscription: no userId in metadata", subscription.id);
    return;
  }

  const item = subscription.items?.data?.[0];
  const priceLookup =
    item?.price?.lookup_key ?? item?.price?.metadata?.lovable_external_id ?? null;
  const tier = priceLookup ? PRICE_TIER[priceLookup] ?? null : null;
  const periodEnd =
    item?.current_period_end ?? subscription.current_period_end ?? null;
  const trialEnd = subscription.trial_end ?? null;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;

  const { data: existing } = await supabase
    .from("coach_profiles")
    .select("entitlement, stripe_subscription_id, subscription_status, subscription_tier")
    .eq("user_id", userId)
    .maybeSingle();
  const currentEnt = (existing as any)?.entitlement as string | undefined;
  const preserve = currentEnt === "club_covered" || currentEnt === "promo_free";
  const currentSubId = (existing as any)?.stripe_subscription_id as string | undefined;
  const currentStatus = (existing as any)?.subscription_status as string | undefined;
  const currentTier = (existing as any)?.subscription_tier as string | undefined;
  const currentIsActive = isActive(currentStatus);
  const incomingIsActive = isActive(subscription.status);
  const tierRank: Record<string, number> = { coach: 1, coach_pro: 2 };

  if (currentSubId && currentSubId !== subscription.id) {
    if (currentIsActive && !incomingIsActive) return;
    if (
      currentIsActive &&
      incomingIsActive &&
      (tierRank[tier ?? ""] ?? 0) <= (tierRank[currentTier ?? ""] ?? 0)
    ) {
      return;
    }
  }

  const nextEnt = preserve
    ? currentEnt
    : incomingIsActive
      ? "paid"
      : "pending";

  const { error } = await supabase
    .from("coach_profiles")
    .update({
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      subscription_tier: tier,
      subscription_environment: env,
      trial_ends_at: trialEnd ? new Date(trialEnd * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      entitlement: nextEnt,
    })
    .eq("user_id", userId);

  if (error) {
    console.error("syncCoachSubscription: failed to update coach_profiles", error);
    throw error;
  }
}

export async function markCoachSubscriptionDeleted(
  supabase: AdminClient,
  subscription: any,
): Promise<void> {
  const userId = subscription.metadata?.userId;
  if (!userId) return;

  const { data: existing } = await supabase
    .from("coach_profiles")
    .select("entitlement, stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();
  const currentEnt = (existing as any)?.entitlement as string | undefined;
  const preserve = currentEnt === "club_covered" || currentEnt === "promo_free";
  const currentSubId = (existing as any)?.stripe_subscription_id as string | undefined;
  if (currentSubId && currentSubId !== subscription.id) return;

  await supabase
    .from("coach_profiles")
    .update({
      subscription_status: "canceled",
      entitlement: preserve ? currentEnt : "pending",
    })
    .eq("user_id", userId);
}
