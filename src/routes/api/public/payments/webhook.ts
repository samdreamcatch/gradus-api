import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type StripeEnv, createStripeClient, verifyWebhook } from "@/lib/stripe.server";
import {
  syncCoachSubscription,
  markCoachSubscriptionDeleted,
} from "@/lib/coach-subscription-sync.server";
import type { Database } from "@/integrations/supabase/types";
import { formatEventDate, planLabelFor, sendBillingNotice } from "@/lib/billing-emails.server";

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

async function syncSubscription(subscription: any, env: StripeEnv) {
  const supabase = getSupabase();
  const { isTeamSubscription, syncParentSubscription } = await import(
    "@/lib/parent-subscription-sync.server"
  );
  if (await isTeamSubscription(supabase as any, subscription)) {
    await syncParentSubscription(supabase as any, subscription, env);
    return;
  }
  await syncCoachSubscription(supabase, subscription, env);
}

async function handleSubscriptionDeleted(subscription: any, _env: StripeEnv) {
  const supabase = getSupabase();
  const { isTeamSubscription, markParentSubscriptionDeleted } = await import(
    "@/lib/parent-subscription-sync.server"
  );
  if (await isTeamSubscription(supabase as any, subscription)) {
    await markParentSubscriptionDeleted(supabase as any, subscription);
    return;
  }
  await markCoachSubscriptionDeleted(supabase, subscription);

  // Auto-downgrade notice: markCoachSubscriptionDeleted has already dropped
  // the coach back to `pending` unless they're club-covered or promo-free.
  const userId =
    (subscription.metadata?.userId as string | undefined) ??
    (await userIdForCustomer(
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
    ));
  if (!userId) return;

  const { data: profile } = await supabase
    .from("coach_profiles")
    .select("entitlement, subscription_tier")
    .eq("user_id", userId)
    .maybeSingle();
  // Nothing was lost if they're still covered another way.
  if (profile && (profile as any).entitlement !== "pending") return;

  await sendBillingNotice(supabase as any, {
    userId,
    kind: "canceled",
    planLabel: planLabelFor((profile as any)?.subscription_tier ?? null),
    dedupeKey: subscription.id,
  });
}

/** Stripe couldn't collect on an invoice — nudge the coach to fix their card. */
async function handleInvoicePaymentFailed(invoice: any) {
  const supabase = getSupabase();
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  const userId = await userIdForCustomer(customerId);
  if (!userId) return;

  const { data: profile } = await supabase
    .from("coach_profiles")
    .select("subscription_tier")
    .eq("user_id", userId)
    .maybeSingle();

  await sendBillingNotice(supabase as any, {
    userId,
    kind: "payment_failed",
    eventDate: formatEventDate(invoice.next_payment_attempt ?? null),
    planLabel: planLabelFor((profile as any)?.subscription_tier ?? null),
    dedupeKey: `${invoice.id}-${invoice.attempt_count ?? 0}`,
  });
}

async function handleCheckoutCompleted(session: any, env: StripeEnv) {
  // Subscription webhook does most of the work; this just backfills the
  // customer id early if the subscription event races.
  const userId = session.metadata?.userId;
  if (!userId || !session.customer) return;
  const supabase = getSupabase();
  if (session.metadata?.plan === "team" || session.metadata?.plan === "family") {
    await supabase
      .from("parent_profiles")
      .update({ stripe_customer_id: session.customer, subscription_environment: env })
      .eq("user_id", userId);
    return;
  }
  await supabase
    .from("coach_profiles")
    .update({
      stripe_customer_id: session.customer,
      subscription_environment: env,
    })
    .eq("user_id", userId);
}

/**
 * Look up the coach's user_id from a Stripe customer id. Used by invoice
 * events, which don't carry userId in their own metadata.
 */
async function userIdForCustomer(customerId: string | null | undefined): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await getSupabase()
    .from("coach_profiles")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return (data as any)?.user_id ?? null;
}

/**
 * Idempotent audit log: one row per Stripe event id. Safe to no-op on
 * duplicate insert because `stripe_event_id` is unique.
 */
async function recordBillingEvent(event: any, env: StripeEnv) {
  const obj = event.data?.object ?? {};
  const type = event.type as string;

  const customerId = typeof obj.customer === "string" ? obj.customer : (obj.customer?.id ?? null);
  const subscriptionId = type.startsWith("customer.subscription")
    ? obj.id
    : typeof obj.subscription === "string"
      ? obj.subscription
      : (obj.subscription?.id ?? null);
  const invoiceId = type.startsWith("invoice.") ? obj.id : null;

  const userId =
    (obj.metadata?.userId as string | undefined) ?? (await userIdForCustomer(customerId));

  const amountCents = type.startsWith("invoice.")
    ? (obj.amount_paid ?? obj.amount_due ?? null)
    : null;
  const currency = obj.currency ?? null;
  const status = obj.status ?? null;

  const item = obj.items?.data?.[0];
  const periodStart = item?.current_period_start ?? obj.period_start ?? null;
  const periodEnd = item?.current_period_end ?? obj.current_period_end ?? obj.period_end ?? null;

  const { error } = await getSupabase()
    .from("billing_events")
    .insert({
      user_id: userId,
      stripe_event_id: event.id,
      event_type: type,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      stripe_invoice_id: invoiceId,
      amount_cents: amountCents,
      currency,
      status,
      period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      environment: env,
      payload: {
        hosted_invoice_url: obj.hosted_invoice_url ?? null,
        number: obj.number ?? null,
        billing_reason: obj.billing_reason ?? null,
        attempt_count: obj.attempt_count ?? null,
      },
    });
  // Unique violation on stripe_event_id = duplicate delivery. Ignore.
  if (error && (error as any).code !== "23505") {
    console.error("billing_events insert failed", error);
  }
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);

  // Record every recognized event before mutating profile state so we always
  // have an audit trail even if the mutation throws.
  const recorded = new Set([
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "checkout.session.completed",
    "invoice.paid",
    "invoice.payment_succeeded",
    "invoice.payment_failed",
  ]);
  if (recorded.has(event.type)) {
    try {
      await recordBillingEvent(event, env);
    } catch (e) {
      console.error("recordBillingEvent failed", e);
    }
  }

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
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event.data.object);
      break;
    case "invoice.paid":
    case "invoice.payment_succeeded":
      // No profile mutation needed — subscription.updated carries the
      // status change (active → past_due → canceled). The audit row above
      // is what powers support / dashboards.
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
