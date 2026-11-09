/**
 * Buying a marketplace plan (migration 20261111120800_plan_purchases).
 *
 * The iOS app asks for a checkout (`startPlanCheckout`) and opens the Stripe
 * Checkout page in Safari. Gradus is the seller of record: the buyer pays the
 * platform account. Once the payment clears (the Checkout webhook, or the app
 * asking for the purchase on its return), `fulfillPurchase` keeps Gradus's 3%
 * platform fee, takes Stripe's processing fee out of the coach's share,
 * transfers the rest to the coach's Connect account, and gives the athlete
 * their own copy of the plan.
 *
 * Who may buy:
 *   - a parent, for one of their children (any age);
 *   - an athlete, for themselves, if their account is active (not
 *     provisional or paused) and they're 13 or older by their birthdate.
 *     Under 13, no birthdate on file, or provisional: their parent buys.
 * Coaches don't buy plans. A plan whose coach can't be paid out yet (Stripe
 * Connect not finished) can't be bought by anyone.
 *
 * Stripe keys (the platform's own, as for Connect):
 *   STRIPE_CONNECT_SECRET_KEY            sk_test_… / sk_live_…
 *   STRIPE_MARKETPLACE_WEBHOOK_SECRET    whsec_… of the endpoint receiving
 *                                        checkout.session.* events
 */
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { createConnectStripeClient } from "./stripe-connect.server";
import { guardianAthleteAccess } from "./team.server";

type Admin = SupabaseClient<Database>;

// The generated types don't know plan_purchases or the newer plan/coach columns yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Untyped = { from: (table: string) => any };
const untyped = (client: Admin) => client as unknown as Untyped;

/** Gradus's cut of every sale. */
export const PLATFORM_FEE_RATE = 0.03;

/** The Stripe calls this module makes; tests pass a fake. */
export type PurchaseStripe = {
  checkout: { sessions: Pick<Stripe["checkout"]["sessions"], "create" | "retrieve"> };
  paymentIntents: Pick<Stripe["paymentIntents"], "retrieve">;
  transfers: Pick<Stripe["transfers"], "create">;
};

export type PurchaseContext = {
  userId: string;
  admin: Admin;
  /** Defaults to the platform client (`createConnectStripeClient`). */
  stripe?: PurchaseStripe;
};

export const startPlanCheckoutInput = z.object({
  /** Who the plan is for. A parent must name their child; an athlete buys for themselves. */
  athleteId: z.string().uuid().optional(),
});

export type PurchaseStatus = "pending" | "fulfilling" | "fulfilled" | "canceled";

export interface PlanPurchaseDTO {
  id: string;
  status: PurchaseStatus;
  /** The listing bought. */
  planId: string | null;
  athleteId: string | null;
  /** The athlete's own copy, once fulfilled. */
  copiedPlanId: string | null;
  amountCents: number;
}

export interface PlanCheckoutDTO {
  purchase: PlanPurchaseDTO;
  /** The Stripe Checkout page to open in Safari; null when nothing is owed (a free plan). */
  checkoutUrl: string | null;
}

type PurchaseRow = {
  id: string;
  plan_id: string | null;
  coach_id: string | null;
  buyer_user_id: string;
  athlete_id: string | null;
  copied_plan_id: string | null;
  amount_cents: number;
  currency: string;
  status: PurchaseStatus;
  stripe_checkout_session_id: string | null;
};

const PURCHASE_COLUMNS =
  "id, plan_id, coach_id, buyer_user_id, athlete_id, copied_plan_id, amount_cents, currency, status, stripe_checkout_session_id";

const toDTO = (row: PurchaseRow): PlanPurchaseDTO => ({
  id: row.id,
  status: row.status,
  planId: row.plan_id,
  athleteId: row.athlete_id,
  copiedPlanId: row.copied_plan_id,
  amountCents: row.amount_cents,
});

const forbidden = (code: string, message: string) => new ApiError({ code, status: 403, message });
const conflict = (code: string, message: string) => new ApiError({ code, status: 409, message });

/** Gradus's 3% and the coach's share, after Stripe's processing fee comes out of the coach's side. */
export function splitPayment(
  amountCents: number,
  stripeFeeCents: number,
): { platformFeeCents: number; coachPayoutCents: number } {
  const platformFeeCents = Math.round(amountCents * PLATFORM_FEE_RATE);
  return {
    platformFeeCents,
    coachPayoutCents: Math.max(0, amountCents - platformFeeCents - stripeFeeCents),
  };
}

/** Whole years between `birthdate` (YYYY-MM-DD) and `today`. */
export function ageOn(birthdate: string, today: Date = new Date()): number {
  const [y, m, d] = birthdate.split("-").map(Number);
  let age = today.getUTCFullYear() - y;
  const beforeBirthday =
    today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * Whether an athlete may buy plans themselves: an active account (not
 * provisional or paused), 13 or older by birthdate. No birthdate counts as a
 * minor we can't place, like under 13: their parent buys. `GET /me` sends
 * this to the app as `athleteCanPurchase`.
 */
export function athleteMayPurchase(
  athlete: { account_state?: string | null; birthdate?: string | null },
  today: Date = new Date(),
): boolean {
  const state = athlete.account_state ?? "active";
  return state === "active" && !!athlete.birthdate && ageOn(athlete.birthdate, today) >= 13;
}

/** Which athlete the caller is buying for, or why they can't buy. */
export async function resolvePurchaseAthlete(
  admin: Admin,
  userId: string,
  athleteId: string | undefined,
  today: Date = new Date(),
): Promise<string> {
  const [parentRes, athleteRes] = await Promise.all([
    admin.from("parent_profiles").select("id").eq("user_id", userId).maybeSingle(),
    admin
      .from("athletes")
      .select("id, birthdate, account_state")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (parentRes.error) dbError(parentRes.error);
  if (athleteRes.error) dbError(athleteRes.error);

  if (parentRes.data) {
    if (!athleteId) {
      throw new ApiError({
        code: "validation_failed",
        status: 400,
        message: "Choose which of your athletes this plan is for.",
      });
    }
    const children = await guardianAthleteAccess(admin, parentRes.data.id);
    if (!children.some((c) => c.athleteId === athleteId)) {
      throw forbidden("forbidden", "You can only buy plans for your own athletes.");
    }
    return athleteId;
  }

  const athlete = athleteRes.data as {
    id: string;
    birthdate: string | null;
    account_state: string | null;
  } | null;
  if (athlete) {
    if (athleteId && athleteId !== athlete.id) {
      throw forbidden("forbidden", "You can only buy plans for yourself.");
    }
    if (athlete.account_state === "provisional") {
      throw forbidden(
        "parent_required",
        "Your account needs a parent's approval before you can buy plans. Ask your parent to buy it for you.",
      );
    }
    if (athlete.account_state === "paused") {
      throw forbidden(
        "account_paused",
        "Your account is paused, so you can't buy plans right now.",
      );
    }
    // No birthdate counts as a minor we can't place, like under 13: a parent buys.
    if (!athlete.birthdate || ageOn(athlete.birthdate, today) < 13) {
      throw forbidden("parent_required", "Ask your parent to buy this plan for you.");
    }
    return athlete.id;
  }

  throw forbidden("forbidden", "Only athletes and parents can buy plans.");
}

type ListingForSale = {
  id: string;
  title: string;
  description: string | null;
  price: number | string;
  status: string;
  coach: {
    id: string;
    user_id: string;
    subscription_tier: string | null;
    organization_id: string | null;
    stripe_connect_account_id: string | null;
    stripe_connect_charges_enabled: boolean | null;
    stripe_connect_payouts_enabled: boolean | null;
  };
};

/** A coach whose Connect account can receive their share and pay it out. */
export const coachCanSell = (coach: {
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean | null;
  stripe_connect_payouts_enabled: boolean | null;
}): boolean =>
  !!coach.stripe_connect_account_id &&
  coach.stripe_connect_charges_enabled === true &&
  coach.stripe_connect_payouts_enabled === true;

async function listingForSale(admin: Admin, planId: string): Promise<ListingForSale> {
  const { data, error } = await untyped(admin)
    .from("plans")
    .select(
      "id, title, description, price, status, coach:coach_profiles!inner(id, user_id, subscription_tier, organization_id, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled)",
    )
    .eq("id", planId)
    .maybeSingle();
  if (error) dbError(error);
  const plan = data as ListingForSale | null;
  // Only what the marketplace lists can be bought: active, by a Coach Pro coach outside a club.
  if (
    !plan ||
    plan.status !== "active" ||
    plan.coach.subscription_tier !== "coach_pro" ||
    plan.coach.organization_id !== null
  ) {
    throw new ApiError({ code: "not_found", status: 404, message: "Plan not found." });
  }
  return plan;
}

/** The buyer's email for Stripe's receipt; undefined when there is none. */
async function buyerEmail(admin: Admin, userId: string): Promise<string | undefined> {
  const { data } = await admin.auth.admin.getUserById(userId);
  return data.user?.email ?? undefined;
}

/**
 * Starts buying `planId` for an athlete: checks who may buy and that the coach
 * can be paid, records a pending purchase, and returns the Stripe Checkout
 * page. A free plan is delivered right away instead.
 */
export async function startPlanCheckout(
  ctx: PurchaseContext,
  planId: string,
  input: z.infer<typeof startPlanCheckoutInput>,
  opts: { origin: string },
): Promise<PlanCheckoutDTO> {
  const plan = await listingForSale(ctx.admin, planId);
  if (plan.coach.user_id === ctx.userId) {
    throw conflict("own_plan", "This is your own plan.");
  }
  if (!coachCanSell(plan.coach)) {
    throw conflict(
      "seller_not_ready",
      "This coach hasn't set up payouts yet, so this plan can't be bought right now.",
    );
  }
  const athleteId = await resolvePurchaseAthlete(ctx.admin, ctx.userId, input.athleteId);

  const owned = await untyped(ctx.admin)
    .from("plan_purchases")
    .select("id")
    .eq("plan_id", planId)
    .eq("athlete_id", athleteId)
    .eq("status", "fulfilled")
    .maybeSingle();
  if (owned.error) dbError(owned.error);
  if (owned.data)
    throw conflict("already_purchased", "This plan has already been bought for this athlete.");

  const amountCents = Math.round(Number(plan.price) * 100);
  const { data: created, error } = await untyped(ctx.admin)
    .from("plan_purchases")
    .insert({
      plan_id: planId,
      coach_id: plan.coach.id,
      buyer_user_id: ctx.userId,
      athlete_id: athleteId,
      amount_cents: amountCents,
      status: amountCents === 0 ? "fulfilling" : "pending",
    })
    .select(PURCHASE_COLUMNS)
    .single();
  if (error) dbError(error);
  const purchase = created as PurchaseRow;

  if (amountCents === 0) {
    // Nothing to pay and nothing to transfer: deliver the copy now.
    const copiedPlanId = await copyPlanForAthlete(ctx.admin, planId, athleteId);
    const done = await updatePurchase(ctx.admin, purchase.id, {
      status: "fulfilled",
      copied_plan_id: copiedPlanId,
      platform_fee_cents: 0,
      stripe_fee_cents: 0,
      coach_payout_cents: 0,
      paid_at: new Date().toISOString(),
    });
    return { purchase: toDTO(done), checkoutUrl: null };
  }

  const stripe = ctx.stripe ?? createConnectStripeClient();
  const complete = `${opts.origin}/purchase/complete?purchase=${purchase.id}`;
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: plan.title,
              ...(plan.description ? { description: plan.description.slice(0, 500) } : {}),
            },
          },
        },
      ],
      customer_email: await buyerEmail(ctx.admin, ctx.userId),
      client_reference_id: purchase.id,
      metadata: { purchase_id: purchase.id, plan_id: planId },
      payment_intent_data: {
        transfer_group: `purchase_${purchase.id}`,
        metadata: { purchase_id: purchase.id, plan_id: planId },
      },
      success_url: complete,
      cancel_url: `${complete}&canceled=1`,
    },
    { idempotencyKey: `gradus-purchase-checkout-${purchase.id}` },
  );
  const saved = await updatePurchase(ctx.admin, purchase.id, {
    stripe_checkout_session_id: session.id,
  });
  return { purchase: toDTO(saved), checkoutUrl: session.url };
}

async function updatePurchase(
  admin: Admin,
  id: string,
  patch: Record<string, unknown>,
): Promise<PurchaseRow> {
  const { data, error } = await untyped(admin)
    .from("plan_purchases")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(PURCHASE_COLUMNS)
    .single();
  if (error) dbError(error);
  return data as PurchaseRow;
}

async function purchaseRow(admin: Admin, id: string): Promise<PurchaseRow | null> {
  const { data, error } = await untyped(admin)
    .from("plan_purchases")
    .select(PURCHASE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) dbError(error);
  return (data as PurchaseRow | null) ?? null;
}

/**
 * The athlete's own copy of a listing: an athlete-owned plan (source
 * 'athlete', no coach) with the listing's title, description and moves, ready
 * to use. The coach's private notes and voice transcript stay with the
 * original; library links are dropped (the moves belong to the coach's
 * library).
 */
export async function copyPlanForAthlete(
  admin: Admin,
  planId: string,
  athleteId: string,
): Promise<string> {
  const { data: source, error } = await untyped(admin)
    .from("plans")
    .select("id, title, description, feedback_scope")
    .eq("id", planId)
    .maybeSingle();
  if (error) dbError(error);
  if (!source) throw new Error("The plan bought no longer exists.");

  const { data: copy, error: insertError } = await untyped(admin)
    .from("plans")
    .insert({
      kind: "plan",
      source: "athlete",
      coach_id: null,
      athlete_id: athleteId,
      title: source.title,
      notes: source.description ?? "",
      status: "active",
      ...(source.feedback_scope ? { feedback_scope: source.feedback_scope } : {}),
    })
    .select("id")
    .single();
  if (insertError) dbError(insertError);

  const { data: moves, error: movesError } = await untyped(admin)
    .from("plan_moves")
    .select("position, name, description, cue, why, target_kind, target_value")
    .eq("plan_id", planId)
    .order("position", { ascending: true });
  if (movesError) dbError(movesError);
  const rows = ((moves ?? []) as Record<string, unknown>[]).map((m) => ({
    ...m,
    plan_id: copy.id,
    move_id: null,
  }));
  if (rows.length) {
    const { error: copyError } = await untyped(admin).from("plan_moves").insert(rows);
    if (copyError) dbError(copyError);
  }
  return copy.id as string;
}

/**
 * Delivers a paid purchase, once: records Stripe's fee, transfers the coach's
 * share to their Connect account, and copies the plan for the athlete. Safe to
 * call from the webhook and from the app's check at the same time; a purchase
 * not paid yet is left as it is, and an expired checkout is marked canceled.
 */
export async function fulfillPurchase(
  admin: Admin,
  stripe: PurchaseStripe,
  purchaseId: string,
): Promise<PurchaseRow | null> {
  const row = await purchaseRow(admin, purchaseId);
  if (!row || row.status === "fulfilled" || row.status === "canceled") return row;
  if (!row.stripe_checkout_session_id) return row;

  const session = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id);
  if (session.status === "expired") {
    return updatePurchase(admin, row.id, { status: "canceled" });
  }
  if (session.payment_status !== "paid") return row;

  // Claim it: only one caller moves pending → fulfilling and does the work.
  const { data: claimed, error: claimError } = await untyped(admin)
    .from("plan_purchases")
    .update({ status: "fulfilling", updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending")
    .select(PURCHASE_COLUMNS)
    .maybeSingle();
  if (claimError) dbError(claimError);
  if (!claimed) return purchaseRow(admin, row.id);

  try {
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!paymentIntentId) throw new Error("Checkout has no payment intent.");
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge.balance_transaction"],
    });
    const charge = intent.latest_charge as Stripe.Charge | null;
    const balance = charge?.balance_transaction as Stripe.BalanceTransaction | null;
    if (!charge || !balance) throw new Error("The payment has no settled charge yet.");
    const { platformFeeCents, coachPayoutCents } = splitPayment(row.amount_cents, balance.fee);

    const { data: coach, error: coachError } = await untyped(admin)
      .from("coach_profiles")
      .select("stripe_connect_account_id")
      .eq("id", row.coach_id)
      .maybeSingle();
    if (coachError) dbError(coachError);
    const destination = coach?.stripe_connect_account_id as string | undefined;
    if (!destination) throw new Error("The coach has no Stripe account to pay.");

    let transferId: string | null = null;
    if (coachPayoutCents > 0) {
      const transfer = await stripe.transfers.create(
        {
          amount: coachPayoutCents,
          currency: row.currency,
          destination,
          // Paid out of this charge, so it goes through before the funds settle.
          source_transaction: charge.id,
          transfer_group: `purchase_${row.id}`,
          metadata: { purchase_id: row.id },
        },
        { idempotencyKey: `gradus-purchase-transfer-${row.id}` },
      );
      transferId = transfer.id;
    }

    const copiedPlanId =
      row.copied_plan_id ??
      (row.plan_id && row.athlete_id
        ? await copyPlanForAthlete(admin, row.plan_id, row.athlete_id)
        : null);

    return await updatePurchase(admin, row.id, {
      status: "fulfilled",
      copied_plan_id: copiedPlanId,
      platform_fee_cents: platformFeeCents,
      stripe_fee_cents: balance.fee,
      coach_payout_cents: coachPayoutCents,
      stripe_payment_intent_id: paymentIntentId,
      stripe_charge_id: charge.id,
      stripe_transfer_id: transferId,
      failure_reason: null,
      paid_at: new Date().toISOString(),
    });
  } catch (e) {
    // Back to pending so the next webhook retry or app check tries again.
    await updatePurchase(admin, row.id, {
      status: "pending",
      failure_reason: e instanceof Error ? e.message.slice(0, 500) : "Fulfilment failed",
    });
    throw e;
  }
}

/** The caller's purchase; a paid one not delivered yet is delivered first. */
export async function getPlanPurchase(
  ctx: PurchaseContext,
  purchaseId: string,
): Promise<PlanPurchaseDTO> {
  const row = await purchaseRow(ctx.admin, purchaseId);
  if (!row || row.buyer_user_id !== ctx.userId) {
    throw new ApiError({ code: "not_found", status: 404, message: "Purchase not found." });
  }
  if (row.status !== "pending") return toDTO(row);
  const stripe = ctx.stripe ?? createConnectStripeClient();
  const current = await fulfillPurchase(ctx.admin, stripe, row.id);
  return toDTO(current ?? row);
}

/** Verifies a Checkout webhook and returns its event (throws when it doesn't verify). */
export async function verifyMarketplaceWebhook(
  req: Request,
  stripe: Stripe = createConnectStripeClient(),
): Promise<Stripe.Event> {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  if (!signature || !body) throw new Error("Missing signature or body");
  const secret = process.env.STRIPE_MARKETPLACE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_MARKETPLACE_WEBHOOK_SECRET is not configured");
  return stripe.webhooks.constructEventAsync(
    body,
    signature,
    secret,
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
}
