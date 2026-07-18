import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type StripeEnv, createStripeClient, verifyWebhook } from "@/lib/stripe.server";
import type { Database } from "@/integrations/supabase/types";

let _supabase: SupabaseClient<Database> | null = null;
function getSupabase(): SupabaseClient<Database> {
  if (!_supabase) {
    _supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

const PRICE_TIER: Record<string, "coach" | "coach_pro"> = {
  coach_monthly: "coach",
  coach_yearly: "coach",
  coach_pro_monthly: "coach_pro",
  coach_pro_yearly: "coach_pro",
};

function isActive(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

async function syncSubscription(subscription: any, env: StripeEnv) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.error("Webhook: no userId in subscription metadata", subscription.id);
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

  const supabase = getSupabase();

  // Preserve club_covered / promo_free entitlements — don't overwrite them.
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

  // If historical duplicate subscriptions emit webhooks, don't let an older
  // lower-tier subscription overwrite the active subscription we already track.
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
    : isActive(subscription.status)
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
    console.error("Webhook: failed to update coach_profiles", error);
    throw error;
  }
}

async function handleSubscriptionDeleted(subscription: any, _env: StripeEnv) {
  const userId = subscription.metadata?.userId;
  if (!userId) return;
  const supabase = getSupabase();

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

async function handleCheckoutCompleted(session: any, env: StripeEnv) {
  // Subscription webhook does most of the work; this just backfills the
  // customer id early if the subscription event races.
  const userId = session.metadata?.userId;
  if (!userId || !session.customer) return;
  const supabase = getSupabase();
  await supabase
    .from("coach_profiles")
    .update({
      stripe_customer_id: session.customer,
      subscription_environment: env,
    })
    .eq("user_id", userId);
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await syncSubscription(event.data.object, env);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object, env);
      break;
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object, env);
      break;
    default:
      console.log("Unhandled payments webhook event:", event.type);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          console.error("Webhook received with invalid env:", rawEnv);
          return Response.json({ received: true, ignored: "invalid env" });
        }
        const env: StripeEnv = rawEnv;
        try {
          // Touch createStripeClient to ensure env vars imported/checked lazily elsewhere.
          void createStripeClient;
          await handleWebhook(request, env);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
