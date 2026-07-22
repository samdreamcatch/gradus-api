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
        .select(
          "id, stripe_customer_id, stripe_subscription_id, subscription_status, promo_code, founding_coach, founding_pro_trial_used",
        )
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

      if (customerId && profile && profile.stripe_customer_id !== customerId) {
        await supabase
          .from("coach_profiles")
          .update({ stripe_customer_id: customerId, subscription_environment: env })
          .eq("id", profile.id);
      }

      // Duplicate guard: after customer resolution, if this coach already has
      // an active-ish subscription in Stripe, do NOT open a new checkout —
      // direct them to use the tier-switch path instead.
      if (customerId) {
        const existing = await stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 20,
        });
        const activeish = existing.data.find((s) =>
          ["active", "trialing", "past_due"].includes(s.status),
        );
        if (activeish) {
          return {
            error:
              "You already have an active subscription. Use “Switch plan” instead of starting a new checkout.",
          };
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

      const tier: "coach" | "coach_pro" = isProPrice ? "coach_pro" : "coach";
      let cardRequiredForPromo = true;

      if (data.promoCode) {
        const typed = await supabaseAdmin
          .from("promo_codes")
          .select(
            "code, active, percent_off, duration, duration_in_months, card_required, applies_to_plans, stripe_promo_id_sandbox, stripe_promo_id_live",
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
        const allowed = (row.applies_to_plans ?? ["coach", "coach_pro"]) as string[];
        if (!allowed.includes(tier)) {
          const label =
            allowed.length === 1
              ? allowed[0] === "coach_pro"
                ? "Coach Pro"
                : "Coach"
              : allowed.join(", ");
          return { error: `This code only applies to ${label}.` };
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
        cardRequiredForPromo = row.card_required !== false;
      } else if (profile?.promo_code) {
        const promoLookup = await supabaseAdmin
          .from("promo_codes")
          .select(
            "code, active, percent_off, duration, card_required, applies_to_plans, stripe_promo_id_sandbox, stripe_promo_id_live",
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
          const allowed = (promo.applies_to_plans ?? ["coach", "coach_pro"]) as string[];
          if (allowed.includes(tier)) {
            const id =
              env === "sandbox"
                ? promo.stripe_promo_id_sandbox
                : promo.stripe_promo_id_live;
            if (id) {
              discountPromoId = id;
              cardRequiredForPromo = promo.card_required !== false;
            } else {
              console.warn(
                `Promo ${profile.promo_code} not yet minted in ${env}; falling back to full price.`,
              );
            }
          }
        }
      }

      // Founding-coach one-time 1-month Coach Pro trial. Only fires when
      // no other promo code is being redeemed at checkout (typed codes and
      // profile-attached forever codes win) and the coach hasn't used the
      // trial before. Card is not collected — Stripe will attempt the first
      // real charge after 30 days.
      const useFoundingProTrial =
        !discountPromoId &&
        isProPrice &&
        Boolean(profile?.founding_coach) &&
        !profile?.founding_pro_trial_used;

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: stripePrice.id, quantity: 1 }],
        mode: "subscription",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        subscription_data: {
          metadata: { userId },
          ...(useFoundingProTrial && { trial_period_days: 30 }),
        },
        metadata: { userId },
        ...(discountPromoId && {
          discounts: [{ promotion_code: discountPromoId }],
          payment_method_collection: cardRequiredForPromo ? "always" : "if_required",
        }),
        ...(useFoundingProTrial && !discountPromoId && {
          payment_method_collection: "if_required",
        }),
      });

      // Persist the promo attribution onto the profile only if it's empty —
      // never overwrite an earlier code (e.g. WELCOME_BACK).
      if (promoCodeToPersist && profile && !profile.promo_code) {
        await supabase
          .from("coach_profiles")
          .update({ promo_code: promoCodeToPersist })
          .eq("id", profile.id)
          .is("promo_code", null);
      }

      // Mark the founding Pro trial as used so it can't be reused later.
      if (useFoundingProTrial && profile) {
        await supabase
          .from("coach_profiles")
          .update({
            founding_pro_trial_used: true,
            founding_pro_trial_started_at: new Date().toISOString(),
          })
          .eq("id", profile.id);
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
      const subscriptions = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        status: "all",
        limit: 20,
      });
      const activeish = subscriptions.data.filter((sub) =>
        ["active", "trialing", "past_due"].includes(sub.status),
      );
      if (activeish.length > 1) {
        return {
          error:
            "We found more than one active subscription on this account. Please contact support before managing billing.",
        };
      }
      const portal = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: data.returnUrl,
      });
      return { url: portal.url };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

type ChangeSubscriptionResult =
  | {
      ok: true;
      /** True if the sub was already on the target price — nothing changed. */
      noop?: boolean;
      /** Cents charged to the card immediately (upgrade proration). 0 if none. */
      chargedCents?: number;
      /** Cents refunded to the card (downgrade proration). 0 if none. */
      refundedCents?: number;
      currency?: string;
      newTier: "coach" | "coach_pro";
    }
  | { error: string };

/**
 * Swap the coach's existing subscription to a different tier/interval price,
 * with immediate proration. Upgrades → prorated charge; downgrades → prorated
 * cash refund to the card. Billing anchor is preserved.
 *
 * This is the ONLY code path for a coach who already has a Stripe subscription
 * to change plans. Never start a second checkout session for them.
 */
export const changeCoachSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        priceId: z.enum([
          "coach_monthly",
          "coach_yearly",
          "coach_pro_monthly",
          "coach_pro_yearly",
        ]),
        environment: z.enum(["sandbox", "live"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ChangeSubscriptionResult> => {
    const { userId, supabase } = context;
    const { data: profile } = await supabase
      .from("coach_profiles")
      .select(
        "stripe_customer_id, stripe_subscription_id, subscription_environment",
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (!profile?.stripe_customer_id) {
      return { error: "No subscription on file yet." };
    }

    const env: StripeEnv =
      (profile.subscription_environment as StripeEnv | null) === "live" ||
      (profile.subscription_environment as StripeEnv | null) === "sandbox"
        ? (profile.subscription_environment as StripeEnv)
        : data.environment;

    const newTier: "coach" | "coach_pro" =
      data.priceId === "coach_pro_monthly" || data.priceId === "coach_pro_yearly"
        ? "coach_pro"
        : "coach";

    try {
      const stripe = createStripeClient(env);

      // Resolve the target price via lookup_key (stable across sandbox/live).
      const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
      if (!prices.data.length) return { error: "Target price not found." };
      const newPrice = prices.data[0];

      // Find the active-ish subscription. Prefer the one we've stored; else
      // pick the first live one on the customer (self-heal from bad state).
      let sub: any = null;
      if (profile.stripe_subscription_id) {
        try {
          sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
        } catch {
          sub = null;
        }
      }
      if (!sub || !["active", "trialing", "past_due"].includes(sub.status)) {
        const list = await stripe.subscriptions.list({
          customer: profile.stripe_customer_id,
          status: "all",
          limit: 20,
        });
        sub =
          list.data.find((s) =>
            ["active", "trialing", "past_due"].includes(s.status),
          ) ?? null;
      }
      if (!sub) return { error: "No active subscription to switch." };

      const item = sub.items?.data?.[0];
      if (!item) return { error: "Subscription has no line item to switch." };

      // No-op if already on target price.
      if (item.price?.id === newPrice.id) {
        return { ok: true, noop: true, newTier };
      }

      // Swap the price in place. `always_invoice` bills the prorated diff now
      // (upgrade) or generates a credit invoice (downgrade). Cycle anchor
      // preserved by default.
      const updated: any = await stripe.subscriptions.update(sub.id, {
        items: [{ id: item.id, price: newPrice.id }],
        proration_behavior: "always_invoice",
        payment_behavior: "error_if_incomplete",
      });

      // Find the invoice Stripe just created for this proration and act on it.
      let chargedCents = 0;
      let refundedCents = 0;
      let currency: string | undefined;

      const latestInvoiceId =
        typeof updated.latest_invoice === "string"
          ? updated.latest_invoice
          : updated.latest_invoice?.id;

      if (latestInvoiceId) {
        const invoice: any = await stripe.invoices.retrieve(latestInvoiceId);
        currency = invoice.currency;

        if ((invoice.amount_paid ?? 0) > 0) {
          chargedCents = invoice.amount_paid;
        }

        // Downgrade: Stripe issues a credit note / negative invoice that lands
        // as customer balance credit. Convert that credit to a cash refund on
        // the most recent paid upgrade-tier charge, capped at what was
        // actually collected on that charge.
        //
        // `invoice.total` is negative for a credit invoice. `amount_remaining`
        // may be 0 with the credit posted to the customer balance instead.
        const creditCents = Math.max(
          0,
          -(invoice.total ?? 0),
          -((invoice.subtotal ?? 0) - (invoice.tax ?? 0)),
        );

        if (creditCents > 0) {
          // Find the last successful charge on this customer to refund against.
          const charges = await stripe.charges.list({
            customer: profile.stripe_customer_id,
            limit: 10,
          });
          const refundableCharge = charges.data.find(
            (c) => c.paid && !c.refunded && (c.amount_captured ?? c.amount) > 0,
          );
          if (refundableCharge) {
            const available =
              (refundableCharge.amount_captured ?? refundableCharge.amount) -
              (refundableCharge.amount_refunded ?? 0);
            const refundAmount = Math.min(creditCents, available);
            if (refundAmount > 0) {
              try {
                await stripe.refunds.create({
                  charge: refundableCharge.id,
                  amount: refundAmount,
                });
                refundedCents = refundAmount;

                // Zero out the corresponding customer balance credit so the
                // coach doesn't get the refund twice (once as cash, once as
                // future-invoice credit).
                try {
                  const fresh: any = await stripe.customers.retrieve(
                    profile.stripe_customer_id,
                  );
                  const balance = fresh?.balance ?? 0;
                  // Stripe balance: negative = credit owed to customer.
                  if (balance < 0) {
                    const zeroOut = Math.min(refundAmount, -balance);
                    if (zeroOut > 0) {
                      await stripe.customers.createBalanceTransaction(
                        profile.stripe_customer_id,
                        {
                          amount: zeroOut, // positive charges back against the credit
                          currency: invoice.currency,
                          description:
                            "Offset for cash refund on tier downgrade",
                        },
                      );
                    }
                  }
                } catch (e) {
                  console.warn("Balance offset failed (non-fatal):", e);
                }
              } catch (e) {
                console.warn("Refund creation failed (non-fatal):", e);
              }
            }
          }
        }
      }

      // Persist tier immediately for snappy UI; webhook will confirm/refine.
      await supabase
        .from("coach_profiles")
        .update({
          subscription_tier: newTier,
          stripe_subscription_id: sub.id,
        })
        .eq("user_id", userId);

      return {
        ok: true,
        chargedCents,
        refundedCents,
        currency,
        newTier,
      };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

