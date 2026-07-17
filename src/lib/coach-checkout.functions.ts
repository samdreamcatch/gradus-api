import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  type StripeEnv,
  createStripeClient,
  getStripeErrorMessage,
} from "@/lib/stripe.server";

const inputSchema = z.object({
  priceId: z.enum([
    "coach_monthly",
    "coach_yearly",
    "coach_pro_monthly",
    "coach_pro_yearly",
  ]),
  environment: z.enum(["sandbox", "live"]),
  returnUrl: z.string().url(),
  // Optional. If provided, must be a valid, active promo code. WILSON/PRACTICE
  // ("repeating" 3 months free) only apply to Coach Pro tiers. "forever"
  // percent-off codes attached to the profile go through the existing branch
  // below and don't need to be sent here.
  promoCode: z
    .string()
    .trim()
    .toUpperCase()
    .max(32)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

type CheckoutSessionResult = { clientSecret: string } | { error: string };

export const startCoachCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<CheckoutSessionResult> => {
    try {
      const env = data.environment as StripeEnv;
      const stripe = createStripeClient(env);
      const { userId, supabase } = context;

      // Look up email + existing customer id + promo code from coach profile.
      const { data: profile } = await supabase
        .from("coach_profiles")
        .select("id, stripe_customer_id, promo_code")
        .eq("user_id", userId)
        .maybeSingle();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const email = user?.email ?? undefined;

      // Resolve or create a Stripe customer scoped by userId metadata.
      let customerId = profile?.stripe_customer_id ?? undefined;
      if (!customerId) {
        const found = await stripe.customers.search({
          query: `metadata['userId']:'${userId}'`,
          limit: 1,
        });
        if (found.data.length) {
          customerId = found.data[0].id;
        } else {
          const created = await stripe.customers.create({
            ...(email && { email }),
            metadata: { userId },
          });
          customerId = created.id;
        }
      }

      // Resolve human-readable price id to the Stripe price.
      const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
      if (!prices.data.length) throw new Error("Price not found");
      const stripePrice = prices.data[0];

      const isProPrice =
        data.priceId === "coach_pro_monthly" ||
        data.priceId === "coach_pro_yearly";

      // Discount resolution — two paths:
      //  1. `promoCode` on the request (typed on the paywall). Must be a
      //     "repeating months free" code and only valid on Coach Pro tiers.
      //     On success we also persist it onto the profile so the webhook +
      //     settings render it consistently.
      //  2. Profile already has an attributed "forever" percent_off code
      //     (existing behaviour). Attached as a lifetime discount.
      let discountPromoId: string | undefined;
      let promoCodeToPersist: string | undefined;

      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );

      if (data.promoCode) {
        const typed = await supabaseAdmin
          .from("promo_codes")
          .select(
            "code, active, percent_off, duration, duration_in_months, stripe_promo_id_sandbox, stripe_promo_id_live",
          )
          .eq("code", data.promoCode)
          .maybeSingle();
        const row = typed.data;
        if (!row || !row.active) {
          return { error: "That promo code isn't valid." };
        }
        if (row.duration !== "repeating") {
          return {
            error:
              "This code isn't redeemable at checkout — it's already applied to your account.",
          };
        }
        if (!isProPrice) {
          return { error: "This code only applies to Coach Pro." };
        }
        const id =
          env === "sandbox"
            ? row.stripe_promo_id_sandbox
            : row.stripe_promo_id_live;
        if (!id) {
          return {
            error: `Promo ${row.code} isn't set up in ${env} yet. Sync it from Admin → Promo codes.`,
          };
        }
        discountPromoId = id;
        promoCodeToPersist = row.code;
      } else if (profile?.promo_code) {
        const promoLookup = await supabaseAdmin
          .from("promo_codes")
          .select(
            "code, active, percent_off, duration, stripe_promo_id_sandbox, stripe_promo_id_live",
          )
          .eq("code", profile.promo_code)
          .maybeSingle();
        const promo = promoLookup.data;
        if (
          promo &&
          promo.active &&
          (promo.percent_off ?? 0) > 0 &&
          (promo.duration ?? "forever") === "forever"
        ) {
          const id =
            env === "sandbox"
              ? promo.stripe_promo_id_sandbox
              : promo.stripe_promo_id_live;
          if (id) discountPromoId = id;
          else {
            console.warn(
              `Promo ${profile.promo_code} not yet minted in ${env}; falling back to full price.`,
            );
          }
        }
      }

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: stripePrice.id, quantity: 1 }],
        mode: "subscription",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        subscription_data: {
          metadata: { userId },
        },
        metadata: { userId },
        ...(discountPromoId && {
          discounts: [{ promotion_code: discountPromoId }],
        }),
      });

      // Persist the promo attribution onto the profile only if it's empty —
      // never overwrite an earlier code (e.g. FOUNDING_COACH).
      if (promoCodeToPersist && profile && !profile.promo_code) {
        await supabase
          .from("coach_profiles")
          .update({ promo_code: promoCodeToPersist })
          .eq("id", profile.id)
          .is("promo_code", null);
      }

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

type PortalSessionResult = { url: string } | { error: string };

/** Opens the Stripe billing portal for the signed-in coach so they can
 *  manage payment methods, cancel, or download invoices. */
export const createCoachBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        environment: z.enum(["sandbox", "live"]),
        returnUrl: z.string().url(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<PortalSessionResult> => {
    const { userId, supabase } = context;
    const { data: profile } = await supabase
      .from("coach_profiles")
      .select("stripe_customer_id, subscription_environment")
      .eq("user_id", userId)
      .maybeSingle();
    if (!profile?.stripe_customer_id) {
      return { error: "No subscription to manage yet." };
    }
    // Prefer the env we recorded when the subscription was set up; fall
    // back to the caller's env so this works during dev before the webhook
    // has run.
    const env: StripeEnv =
      (profile.subscription_environment as StripeEnv | null) === "live" ||
      (profile.subscription_environment as StripeEnv | null) === "sandbox"
        ? (profile.subscription_environment as StripeEnv)
        : data.environment;
    try {
      const stripe = createStripeClient(env);
      const portal = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: data.returnUrl,
      });
      return { url: portal.url };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
