/**
 * Mirrors a Stripe Team plan subscription onto `parent_profiles`.
 * Called from the payments webhook when the subscription is marked
 * `metadata.plan = "family"` (or its customer maps to a parent profile).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StripeEnv } from "@/lib/stripe.server";

type Client = SupabaseClient<any, any, any>;

function customerIdOf(subscription: any): string | null {
  return typeof subscription.customer === "string"
    ? subscription.customer
    : (subscription.customer?.id ?? null);
}

/** True when this subscription belongs to a parent (Family) plan. */
export async function isTeamSubscription(supabase: Client, subscription: any): Promise<boolean> {
  if (subscription?.metadata?.plan === "family") return true;
  const customerId = customerIdOf(subscription);
  if (!customerId) return false;
  const { data } = await supabase
    .from("parent_profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return !!data;
}

async function resolveParentId(supabase: Client, subscription: any): Promise<string | null> {
  const userId = subscription?.metadata?.userId as string | undefined;
  if (userId) {
    const { data } = await supabase
      .from("parent_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }
  const customerId = customerIdOf(subscription);
  if (!customerId) return null;
  const { data } = await supabase
    .from("parent_profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function syncParentSubscription(
  supabase: Client,
  subscription: any,
  env: StripeEnv,
): Promise<void> {
  const parentId = await resolveParentId(supabase, subscription);
  if (!parentId) return;

  const item = subscription.items?.data?.[0];
  const periodEnd = item?.current_period_end ?? subscription.current_period_end ?? null;

  const { error } = await supabase
    .from("parent_profiles")
    .update({
      stripe_customer_id: customerIdOf(subscription),
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      subscription_environment: env,
    })
    .eq("id", parentId);
  if (error) console.error("[team] parent subscription sync failed", error);
}

export async function markParentSubscriptionDeleted(
  supabase: Client,
  subscription: any,
): Promise<void> {
  const parentId = await resolveParentId(supabase, subscription);
  if (!parentId) return;
  const { error } = await supabase
    .from("parent_profiles")
    .update({ subscription_status: "canceled" })
    .eq("id", parentId);
  if (error) console.error("[team] parent subscription delete failed", error);
}
