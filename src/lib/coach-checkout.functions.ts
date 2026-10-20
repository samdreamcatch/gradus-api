import { FOUNDING_PRO_TRIAL_DAYS } from "@/lib/paywall-flag";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
// Billing columns on coach_profiles are guarded by a trigger that only the
// service role may pass (supabase/migrations/20260905200000_protect_billing_columns.sql),
// so every write below goes through the admin client. Row targeting stays
// explicit (.eq on the caller's own profile) because RLS no longer applies.
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";
import {
  claimFoundingCoachTier as claimFoundingCoachTierImpl,
  restoreFoundingCoachTier as restoreFoundingCoachTierImpl,
  restoreFoundingCoachTierInput,
} from "@/lib/founding-tier.server";

const inputSchema = z.object({
  priceId: z.enum(["coach_monthly", "coach_yearly", "coach_pro_monthly", "coach_pro_yearly"]),
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

type CheckoutSessionResult = { clientSecret: string; sessionId: string } | { error: string };

export const startCoachCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<CheckoutSessionResult> => {
    try {
      const env = data.environment as StripeEnv;
      const stripe = createStripeClient(env);
      const { userId, supabase } = context;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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
        await supabaseAdmin
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
        data.priceId === "coach_pro_monthly" || data.priceId === "coach_pro_yearly";

      // Discount resolution — two paths:
      //  1. `promoCode` on the request (typed on the paywall). Must be a
      //     "repeating months free" code and only valid on Coach Pro tiers.
      //     On success we also persist it onto the profile so the webhook +
      //     settings render it consistently.
      //  2. Profile already has an attributed "forever" percent_off code
      //     (existing behaviour). Attached as a lifetime discount.
      let discountPromoId: string | undefined;
      let promoCodeToPersist: string | undefined;

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
            error: "This code isn't redeemable at checkout — it's already applied to your account.",
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
        const id = env === "sandbox" ? row.stripe_promo_id_sandbox : row.stripe_promo_id_live;
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
        // Honor both forever codes (FOUNDING_COACH) and repeating ones
        // (WILSON / PRACTICE / WELCOME_BACK) that were attached to the
        // profile at signup or when leaving a club.
        if (
          promo &&
          promo.active &&
          (promo.percent_off ?? 0) > 0 &&
          ["forever", "repeating"].includes(promo.duration ?? "forever")
        ) {
          const allowed = (promo.applies_to_plans ?? ["coach", "coach_pro"]) as string[];
          if (allowed.includes(tier)) {
            const id =
              env === "sandbox" ? promo.stripe_promo_id_sandbox : promo.stripe_promo_id_live;
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
      // trial before. The free founding trial days remain, but a card is collected up
      // front so the first charge after the trial can't silently fail.
      const useFoundingProTrial =
        !discountPromoId &&
        isProPrice &&
        Boolean(profile?.founding_coach) &&
        !profile?.founding_pro_trial_used;

      // Card is required to start ANY trial or discounted subscription.
      // `promo_codes.card_required` is still stored and editable in admin,
      // but while this constant is true the checkout path ignores a `false`
      // value. Flip to false to re-honor per-code card-free starts.
      const ALWAYS_REQUIRE_CARD = true;
      const paymentMethodCollection: "always" | "if_required" =
        ALWAYS_REQUIRE_CARD || cardRequiredForPromo ? "always" : "if_required";

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: stripePrice.id, quantity: 1 }],
        mode: "subscription",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        subscription_data: {
          metadata: { userId },
          ...(useFoundingProTrial && { trial_period_days: FOUNDING_PRO_TRIAL_DAYS }),
        },
        metadata: { userId },
        payment_method_collection: paymentMethodCollection,
        ...(discountPromoId && {
          discounts: [{ promotion_code: discountPromoId }],
        }),
      });

      // Persist the promo attribution onto the profile only if it's empty —
      // never overwrite an earlier code (e.g. WELCOME_BACK).
      if (promoCodeToPersist && profile && !profile.promo_code) {
        await supabaseAdmin
          .from("coach_profiles")
          .update({ promo_code: promoCodeToPersist })
          .eq("id", profile.id)
          .is("promo_code", null);
      }

      // Mark the founding Pro trial as used so it can't be reused later.
      if (useFoundingProTrial && profile) {
        await supabaseAdmin
          .from("coach_profiles")
          .update({
            founding_pro_trial_used: true,
            founding_pro_trial_started_at: new Date().toISOString(),
          })
          .eq("id", profile.id);
      }

      return { clientSecret: session.client_secret ?? "", sessionId: session.id };
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
        priceId: z.enum(["coach_monthly", "coach_yearly", "coach_pro_monthly", "coach_pro_yearly"]),
        environment: z.enum(["sandbox", "live"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ChangeSubscriptionResult> => {
    const { userId, supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabase
      .from("coach_profiles")
      .select("stripe_customer_id, stripe_subscription_id, subscription_environment")
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
        sub = list.data.find((s) => ["active", "trialing", "past_due"].includes(s.status)) ?? null;
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
                  const fresh: any = await stripe.customers.retrieve(profile.stripe_customer_id);
                  const balance = fresh?.balance ?? 0;
                  // Stripe balance: negative = credit owed to customer.
                  if (balance < 0) {
                    const zeroOut = Math.min(refundAmount, -balance);
                    if (zeroOut > 0) {
                      await stripe.customers.createBalanceTransaction(profile.stripe_customer_id, {
                        amount: zeroOut, // positive charges back against the credit
                        currency: invoice.currency,
                        description: "Offset for cash refund on tier downgrade",
                      });
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
      await supabaseAdmin
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

type VerifyCheckoutResult = { ok: true; status: string; entitled: boolean } | { error: string };

/**
 * Called by the paywall when Stripe redirects the coach back with
 * `?session_id={CHECKOUT_SESSION_ID}`. Synchronously fetches the session
 * + subscription from Stripe and syncs it onto coach_profiles, so the
 * paywall doesn't have to wait for the webhook to race in.
 *
 * Idempotent: uses the same sync helper as the webhook and only touches
 * the caller's own profile (checked via userId in subscription.metadata).
 */
export const verifyCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().min(1).max(200),
        environment: z.enum(["sandbox", "live"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<VerifyCheckoutResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      const env = data.environment as StripeEnv;
      const stripe = createStripeClient(env);
      const session: any = await stripe.checkout.sessions.retrieve(data.sessionId, {
        expand: ["subscription", "subscription.items.data.price"],
      });

      // Only accept sessions minted for this user.
      if (session.metadata?.userId && session.metadata.userId !== context.userId) {
        return { error: "Session does not belong to this account." };
      }

      const sub = session.subscription;
      if (!sub || typeof sub === "string") {
        // Payment not yet complete or subscription not attached yet.
        return { ok: true, status: session.status ?? "open", entitled: false };
      }

      // Force userId into metadata in case Stripe returned a lean object.
      if (!sub.metadata?.userId) {
        sub.metadata = { ...(sub.metadata ?? {}), userId: context.userId };
      }

      const { syncCoachSubscription } = await import("@/lib/coach-subscription-sync.server");
      await syncCoachSubscription(supabaseAdmin, sub, env);

      // Best-effort audit row so support can see the verify path fired.
      try {
        await supabaseAdmin.from("billing_events").insert({
          user_id: context.userId,
          stripe_event_id: `verify_${session.id}`,
          event_type: "checkout.session.verified",
          stripe_customer_id:
            typeof sub.customer === "string" ? sub.customer : (sub.customer?.id ?? null),
          stripe_subscription_id: sub.id,
          status: sub.status,
          environment: env,
          payload: { source: "verifyCheckoutSession" },
        });
      } catch {
        /* unique violation on duplicate verify is fine */
      }

      const entitled = ["active", "trialing", "past_due"].includes(sub.status);
      return { ok: true, status: sub.status, entitled };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

/**
 * Founding Coach tier claim/restore — thin wrappers over the shared entry
 * points in src/lib/founding-tier.server.ts, shared with the
 * `/api/v1/coach/founding/…` routes (PRD §3.6/§3.7, Appendix A). Names,
 * methods, input schemas and the `{ ok } | { error }` results are unchanged:
 * the paywall matches on `"error" in res`, so the shared module's `ApiError`s
 * come back as `{ error: message }` here instead of being thrown.
 */
function toFoundingResult(err: unknown): { error: string } {
  if (err instanceof Error) return { error: err.message };
  throw err;
}

/**
 * Founding-coach free-Coach-tier claim. Grants entitlement without touching
 * Stripe so a brand-new coach can proceed through onboarding without a
 * checkout session. Idempotent — safe to call repeatedly.
 */
export const claimFoundingCoachTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true } | { error: string }> => {
    const { userId, supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      return await claimFoundingCoachTierImpl({ userId, supabase, admin: supabaseAdmin });
    } catch (err) {
      return toFoundingResult(err);
    }
  });

/**
 * Founding-coach downgrade: cancel any active Coach Pro subscription and
 * restore the free founding Coach tier without proration/refund logic
 * running through changeCoachSubscription (which would try to swap to a
 * paid Coach price). Safe if no active sub exists.
 */
export const restoreFoundingCoachTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => restoreFoundingCoachTierInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
    const { userId, supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      return await restoreFoundingCoachTierImpl({ userId, supabase, admin: supabaseAdmin }, data);
    } catch (err) {
      return toFoundingResult(err);
    }
  });
