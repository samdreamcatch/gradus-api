/**
 * Family plan billing for parent accounts — embedded checkout + Stripe
 * billing portal. Mirrors the coach checkout flow, but writes to
 * `parent_profiles` and stamps `metadata.plan = "family"` so the payments
 * webhook routes the subscription to the parent sync.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

type CheckoutResult = { clientSecret: string; sessionId: string } | { error: string };
type PortalResult = { url: string } | { error: string };

export const startFamilyCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        priceId: z.enum(["family_monthly", "family_yearly"]),
        environment: z.enum(["sandbox", "live"]),
        returnUrl: z.string().url(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    try {
      const env = data.environment as StripeEnv;
      const stripe = createStripeClient(env);
      const { userId, supabase } = context;

      const { data: profile } = await supabase
        .from("parent_profiles")
        .select("id, stripe_customer_id, subscription_status")
        .eq("user_id", userId)
        .maybeSingle();
      if (!profile) return { error: "Parent profile not found." };

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const email = user?.email ?? undefined;

      let customerId = (profile as any).stripe_customer_id as string | undefined;
      if (!customerId) {
        const found = await stripe.customers.search({
          query: `metadata['userId']:'${userId}'`,
          limit: 1,
        });
        customerId = found.data.length
          ? found.data[0].id
          : (await stripe.customers.create({ ...(email && { email }), metadata: { userId } })).id;
      }

      const existing = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
      });
      if (
        existing.data.some(
          (s) => s.metadata?.plan === "family" && ["active", "trialing", "past_due"].includes(s.status),
        )
      ) {
        return { error: "You already have an active Family plan. Use “Manage billing” instead." };
      }

      const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
      if (!prices.data.length) return { error: "Price not found." };

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: prices.data[0].id, quantity: 1 }],
        mode: "subscription",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        metadata: { userId, plan: "family" },
        subscription_data: { metadata: { userId, plan: "family" } },
      } as any);

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("parent_profiles")
        .update({ stripe_customer_id: customerId, subscription_environment: env })
        .eq("id", (profile as any).id);

      return { clientSecret: session.client_secret ?? "", sessionId: session.id };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const createParentBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        environment: z.enum(["sandbox", "live"]),
        returnUrl: z.string().url().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<PortalResult> => {
    const { data: profile } = await context.supabase
      .from("parent_profiles")
      .select("stripe_customer_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const customerId = (profile as any)?.stripe_customer_id as string | undefined;
    if (!customerId) return { error: "No billing account yet." };

    try {
      const stripe = createStripeClient(data.environment as StripeEnv);
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        ...(data.returnUrl && { return_url: data.returnUrl }),
      });
      return { url: portal.url };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

/** Family plan status for the signed-in parent (drives the settings UI). */
export const getFamilyPlanStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase
      .from("parent_profiles")
      .select("subscription_status, current_period_end, stripe_customer_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const status = (profile as any)?.subscription_status as string | null;
    const periodEnd = (profile as any)?.current_period_end as string | null;
    const notExpired = !periodEnd || new Date(periodEnd).getTime() > Date.now();
    const active =
      !!status && ["active", "trialing", "past_due", "canceled"].includes(status) && notExpired;
    return {
      active,
      status: status ?? null,
      currentPeriodEnd: periodEnd,
      hasBillingAccount: !!(profile as any)?.stripe_customer_id,
    };
  });
