/**
 * Mirrors a Stripe Team plan subscription onto `parent_profiles`.
 * Called from the payments webhook when the subscription is marked
 * `metadata.plan = "team"` (legacy: "family") or its customer maps to a parent profile.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StripeEnv } from "@/lib/stripe.server";
import { inBackground } from "./background";
import { notifyUsers, parentUserId } from "./push-notify.server";

type Client = SupabaseClient<any, any, any>;

/** Silent push so the app refreshes `/me` after Stripe changed the Team plan (PRD §6.6). */
async function pushTeamPlanChanged(supabase: Client, parentId: string): Promise<void> {
  await inBackground("push:team-entitlement", async () => {
    const userId = await parentUserId(supabase, parentId);
    if (!userId) return;
    await notifyUsers(supabase, [userId], {
      type: "entitlement",
      route: "settings/plan",
      silent: true,
      collapseId: `entitlement:${userId}`,
    });
  });
}

function customerIdOf(subscription: any): string | null {
  return typeof subscription.customer === "string"
    ? subscription.customer
    : (subscription.customer?.id ?? null);
}

/** True when this subscription belongs to a parent (Team) plan. */
export async function isTeamSubscription(supabase: Client, subscription: any): Promise<boolean> {
  const planTag = subscription?.metadata?.plan;
  // "family" is the legacy tag for subscriptions created before the rename.
  if (planTag === "team" || planTag === "family") return true;
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
  const nextPeriodEnd = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

  const { data: before } = await supabase
    .from("parent_profiles")
    .select("subscription_status, current_period_end")
    .eq("id", parentId)
    .maybeSingle();
  const prev = before as {
    subscription_status: string | null;
    current_period_end: string | null;
  } | null;
  const changed =
    !prev ||
    prev.subscription_status !== subscription.status ||
    (prev.current_period_end ? new Date(prev.current_period_end).toISOString() : null) !==
      nextPeriodEnd;

  const { error } = await supabase
    .from("parent_profiles")
    .update({
      stripe_customer_id: customerIdOf(subscription),
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      current_period_end: nextPeriodEnd,
      subscription_environment: env,
    })
    .eq("id", parentId);
  if (error) console.error("[team] parent subscription sync failed", error);
  else if (changed) await pushTeamPlanChanged(supabase, parentId);
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
  else await pushTeamPlanChanged(supabase, parentId);
}
