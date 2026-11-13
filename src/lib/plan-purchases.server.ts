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
 * Coaches don't buy plans.
 *
 * Paying (migration 20261111121000_plan_purchases_payment_status):
 *   - coach's Stripe payouts on: pay at checkout, then the plan is delivered
 *     (`payment_status` paid);
 *   - coach not on Stripe yet: the plan is delivered right away without
 *     paying (`awaiting_coach_setup`). Once the coach's payouts are on it
 *     becomes `payment_due` and the buyer completes payment from the plan
 *     (`payPlanPurchase`). Unpaid `PAYMENT_GRACE_DAYS` after it became due,
 *     the coach may restrict the buyer (`restrictPlanPurchase`), which
 *     removes their copy.
 * Buyers list their purchases (`listMyPlanPurchases`) and coaches their
 * sales, received and pending (`listCoachSales`).
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
import {
  applyPromoCodeInput,
  resolvePromoForPlan,
  type AppliedPromo,
} from "./coach-promo-codes.server";
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

/** Days a buyer has to pay once payment is due before the coach may restrict them. */
export const PAYMENT_GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  /** One of the plan's coach's promo codes (any case); see `previewPlanPromoCode`. */
  promoCode: z.string().trim().min(1).max(64).optional(),
});

/** Delivery: pending (at checkout), fulfilling, fulfilled (plan delivered), canceled, restricted (coach removed access). */
export type PurchaseStatus = "pending" | "fulfilling" | "fulfilled" | "canceled" | "restricted";

/** Money: awaiting_coach_setup (nothing owed yet), payment_due, processing, paid. */
export type PaymentStatus = "awaiting_coach_setup" | "payment_due" | "processing" | "paid";

export interface PlanPurchaseDTO {
  id: string;
  status: PurchaseStatus;
  paymentStatus: PaymentStatus;
  /** The listing bought. */
  planId: string | null;
  athleteId: string | null;
  /** The athlete's own copy, once delivered. */
  copiedPlanId: string | null;
  /** What's charged, after any promo code. */
  amountCents: number;
  /** The plan's price before any promo code. */
  originalAmountCents: number;
  /** The promo code applied, as it was applied; null when none. */
  promoCode: string | null;
  /** Since when the buyer owes it; null while nothing is owed. */
  paymentDueAt: string | null;
  paidAt: string | null;
  /** Unpaid `PAYMENT_GRACE_DAYS` after it became due: the coach may restrict. */
  overdue: boolean;
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
  original_amount_cents: number | null;
  promo_code: string | null;
  currency: string;
  status: PurchaseStatus;
  payment_status: PaymentStatus | null;
  payment_due_at: string | null;
  paid_at: string | null;
  platform_fee_cents: number | null;
  stripe_fee_cents: number | null;
  coach_payout_cents: number | null;
  stripe_checkout_session_id: string | null;
  created_at: string;
};

const PURCHASE_COLUMNS =
  "id, plan_id, coach_id, buyer_user_id, athlete_id, copied_plan_id, amount_cents, original_amount_cents, promo_code, currency, status, payment_status, payment_due_at, paid_at, platform_fee_cents, stripe_fee_cents, coach_payout_cents, stripe_checkout_session_id, created_at";

/** A row from before payment_status existed counts as paid once delivered (the migration labels them). */
const paymentStatusOf = (row: PurchaseRow): PaymentStatus =>
  row.payment_status ?? (row.status === "fulfilled" ? "paid" : "payment_due");

/** Unpaid `PAYMENT_GRACE_DAYS` or more after payment became due, and still delivered. */
export function isOverdue(row: PurchaseRow, now: Date = new Date()): boolean {
  return (
    row.status === "fulfilled" &&
    paymentStatusOf(row) === "payment_due" &&
    !!row.payment_due_at &&
    now.getTime() - new Date(row.payment_due_at).getTime() >= PAYMENT_GRACE_DAYS * DAY_MS
  );
}

const toDTO = (row: PurchaseRow, now: Date = new Date()): PlanPurchaseDTO => ({
  id: row.id,
  status: row.status,
  paymentStatus: paymentStatusOf(row),
  planId: row.plan_id,
  athleteId: row.athlete_id,
  copiedPlanId: row.copied_plan_id,
  amountCents: row.amount_cents,
  originalAmountCents: row.original_amount_cents ?? row.amount_cents,
  promoCode: row.promo_code,
  paymentDueAt: row.payment_due_at,
  paidAt: row.paid_at,
  overdue: isOverdue(row, now),
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

export interface PlanPromoPreviewDTO {
  /** The code as the coach saved it. */
  code: string;
  discountType: "percent" | "fixed";
  /** percent: 1–100; fixed: USD. */
  discountValue: number;
  originalAmountCents: number;
  discountCents: number;
  /** What the buyer would pay; 0 is free (no checkout). */
  amountCents: number;
}

/**
 * `POST /api/v1/marketplace/plans/{id}/promo-code`: what a promo code takes
 * off this listing for the caller, before they buy. Changes nothing; the code
 * is checked again at checkout. Errors as `resolvePromoForPlan`.
 */
export async function previewPlanPromoCode(
  ctx: PurchaseContext,
  planId: string,
  input: z.infer<typeof applyPromoCodeInput>,
): Promise<PlanPromoPreviewDTO> {
  const plan = await listingForSale(ctx.admin, planId);
  if (plan.coach.user_id === ctx.userId) {
    throw conflict("own_plan", "This is your own plan.");
  }
  const promo = await resolvePromoForPlan(ctx.admin, {
    coachId: plan.coach.id,
    planId,
    originalAmountCents: Math.round(Number(plan.price) * 100),
    buyerUserId: ctx.userId,
    code: input.code,
  });
  return {
    code: promo.code,
    discountType: promo.discountType,
    discountValue: promo.discountValue,
    originalAmountCents: promo.originalAmountCents,
    discountCents: promo.discountCents,
    amountCents: promo.amountCents,
  };
}

/**
 * Starts buying `planId` for an athlete. Checks who may buy and applies any
 * promo code (`resolvePromoForPlan`), then:
 *   - a free plan (or one a promo code makes free) is delivered right away;
 *   - a coach not on Stripe yet: delivered right away, nothing owed until
 *     their payouts are on (`awaiting_coach_setup`), no checkout page;
 *   - otherwise: a pending purchase and the Stripe Checkout page to pay first.
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

  const originalAmountCents = Math.round(Number(plan.price) * 100);
  const promo: AppliedPromo | null = input.promoCode
    ? await resolvePromoForPlan(ctx.admin, {
        coachId: plan.coach.id,
        planId,
        originalAmountCents,
        buyerUserId: ctx.userId,
        code: input.promoCode,
      })
    : null;
  const amountCents = promo?.amountCents ?? originalAmountCents;
  const free = amountCents === 0;
  const payLater = !free && !coachCanSell(plan.coach);
  const now = new Date().toISOString();
  const { data: created, error } = await untyped(ctx.admin)
    .from("plan_purchases")
    .insert({
      plan_id: planId,
      coach_id: plan.coach.id,
      buyer_user_id: ctx.userId,
      athlete_id: athleteId,
      amount_cents: amountCents,
      original_amount_cents: originalAmountCents,
      promo_code_id: promo?.promoCodeId ?? null,
      promo_code: promo?.code ?? null,
      status: free || payLater ? "fulfilling" : "pending",
      payment_status: free ? "paid" : payLater ? "awaiting_coach_setup" : "payment_due",
      payment_due_at: free || payLater ? null : now,
    })
    .select(PURCHASE_COLUMNS)
    .single();
  if (error) dbError(error);
  const purchase = created as PurchaseRow;

  if (free || payLater) {
    // Deliver the copy now: nothing to pay (free), or nothing owed until the coach can be paid.
    const copiedPlanId = await copyPlanForAthlete(ctx.admin, planId, athleteId);
    const done = await updatePurchase(ctx.admin, purchase.id, {
      status: "fulfilled",
      copied_plan_id: copiedPlanId,
      ...(free
        ? { platform_fee_cents: 0, stripe_fee_cents: 0, coach_payout_cents: 0, paid_at: now }
        : {}),
    });
    return { purchase: toDTO(done), checkoutUrl: null };
  }

  const url = await openCheckout(ctx, purchase, plan.title, plan.description, opts.origin);
  return {
    purchase: toDTO((await purchaseRow(ctx.admin, purchase.id)) ?? purchase),
    checkoutUrl: url,
  };
}

/**
 * A Stripe Checkout page for what `purchase` owes; saves its session on the
 * purchase. Each call opens a new session, so a retry never replays an
 * expired one.
 */
async function openCheckout(
  ctx: PurchaseContext,
  purchase: PurchaseRow,
  title: string,
  description: string | null,
  origin: string,
  /** A web page to come back to (`/parent/settings/payments`); the app otherwise. */
  returnTo?: string,
): Promise<string | null> {
  const stripe = ctx.stripe ?? createConnectStripeClient();
  const complete = `${origin}/purchase/complete?purchase=${purchase.id}${
    returnTo ? `&return=${encodeURIComponent(returnTo)}` : ""
  }`;
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: purchase.currency || "usd",
            unit_amount: purchase.amount_cents,
            product_data: {
              name: title,
              ...(description ? { description: description.slice(0, 500) } : {}),
            },
          },
        },
      ],
      customer_email: await buyerEmail(ctx.admin, purchase.buyer_user_id),
      client_reference_id: purchase.id,
      metadata: {
        purchase_id: purchase.id,
        ...(purchase.plan_id ? { plan_id: purchase.plan_id } : {}),
      },
      payment_intent_data: {
        transfer_group: `purchase_${purchase.id}`,
        metadata: { purchase_id: purchase.id },
      },
      success_url: complete,
      cancel_url: `${complete}&canceled=1`,
    },
    { idempotencyKey: `gradus-purchase-checkout-${purchase.id}-${Date.now()}` },
  );
  await updatePurchase(ctx.admin, purchase.id, { stripe_checkout_session_id: session.id });
  return session.url;
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
 * Records a paid checkout, once: Stripe's fee, the coach's share transferred
 * to their Connect account, `payment_status` paid, and (if it wasn't delivered
 * already) the athlete's copy of the plan. Safe to call from the webhook and
 * from the app's check at the same time; a checkout not paid yet is left as
 * it is. An expired checkout cancels a purchase still at checkout; a plan
 * already delivered just stays due.
 */
export async function fulfillPurchase(
  admin: Admin,
  stripe: PurchaseStripe,
  purchaseId: string,
): Promise<PurchaseRow | null> {
  const row = await purchaseRow(admin, purchaseId);
  if (!row || row.status === "canceled" || row.status === "restricted") return row;
  if (paymentStatusOf(row) !== "payment_due" || !row.stripe_checkout_session_id) return row;

  const session = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id);
  if (session.status === "expired") {
    return row.status === "pending"
      ? updatePurchase(admin, row.id, { status: "canceled" })
      : updatePurchase(admin, row.id, { stripe_checkout_session_id: null });
  }
  if (session.payment_status !== "paid") return row;

  // Claim it: only one caller moves payment_due → processing and does the work.
  const { data: claimed, error: claimError } = await untyped(admin)
    .from("plan_purchases")
    .update({ payment_status: "processing", updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("payment_status", "payment_due")
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
      payment_status: "paid",
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
    // Back to due so the next webhook retry or app check tries again.
    await updatePurchase(admin, row.id, {
      payment_status: "payment_due",
      failure_reason: e instanceof Error ? e.message.slice(0, 500) : "Fulfilment failed",
    });
    throw e;
  }
}

const purchaseNotFound = () =>
  new ApiError({ code: "not_found", status: 404, message: "Purchase not found." });

/**
 * The caller's purchase; a checkout paid but not recorded yet is recorded
 * first, and one waiting on a coach who's now on Stripe becomes due.
 */
export async function getPlanPurchase(
  ctx: PurchaseContext,
  purchaseId: string,
): Promise<PlanPurchaseDTO> {
  const row = await purchaseRow(ctx.admin, purchaseId);
  if (!row || row.buyer_user_id !== ctx.userId) throw purchaseNotFound();
  const [current] = await promoteWhenCoachReady(ctx.admin, [row]);
  if (paymentStatusOf(current) !== "payment_due" || !current.stripe_checkout_session_id) {
    return toDTO(current);
  }
  const stripe = ctx.stripe ?? createConnectStripeClient();
  return toDTO((await fulfillPurchase(ctx.admin, stripe, current.id)) ?? current);
}

/**
 * Purchases waiting on their coach become due once the coach's payouts are on.
 * `syncConnectAccount` does this when Stripe reports it; this catches any it
 * missed, for the rows being read.
 */
async function promoteWhenCoachReady(admin: Admin, rows: PurchaseRow[]): Promise<PurchaseRow[]> {
  const waiting = rows.filter(
    (r) => r.status === "fulfilled" && paymentStatusOf(r) === "awaiting_coach_setup" && r.coach_id,
  );
  if (waiting.length === 0) return rows;
  const coachIds = [...new Set(waiting.map((r) => r.coach_id as string))];
  const { data, error } = await untyped(admin)
    .from("coach_profiles")
    .select(
      "id, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled",
    )
    .in("id", coachIds);
  if (error) dbError(error);
  const ready = new Set(
    ((data ?? []) as (Parameters<typeof coachCanSell>[0] & { id: string })[])
      .filter(coachCanSell)
      .map((c) => c.id),
  );
  if (ready.size === 0) return rows;
  const now = new Date().toISOString();
  const promoted = new Map<string, PurchaseRow>();
  for (const r of waiting) {
    if (!ready.has(r.coach_id as string)) continue;
    promoted.set(
      r.id,
      await updatePurchase(admin, r.id, { payment_status: "payment_due", payment_due_at: now }),
    );
  }
  return rows.map((r) => promoted.get(r.id) ?? r);
}

/**
 * "Complete payment": a Stripe Checkout page for a delivered plan the caller
 * owes. 409 while the coach isn't on Stripe yet, or when it's already paid.
 */
export async function payPlanPurchase(
  ctx: PurchaseContext,
  purchaseId: string,
  opts: { origin: string; returnTo?: string },
): Promise<PlanCheckoutDTO> {
  const found = await purchaseRow(ctx.admin, purchaseId);
  if (!found || found.buyer_user_id !== ctx.userId) throw purchaseNotFound();
  if (found.status !== "fulfilled") {
    throw conflict("not_payable", "This purchase can't be paid.");
  }
  const [row] = await promoteWhenCoachReady(ctx.admin, [found]);
  switch (paymentStatusOf(row)) {
    case "paid":
      throw conflict("already_paid", "This plan is already paid for.");
    case "processing":
      throw conflict("payment_processing", "Your payment is being processed.");
    case "awaiting_coach_setup":
      throw conflict(
        "coach_not_ready",
        "The coach hasn't set up payouts yet. You'll be able to pay once they do.",
      );
    case "payment_due":
      break;
  }

  const stripe = ctx.stripe ?? createConnectStripeClient();
  // An open checkout from an earlier tap is reused; a paid one is recorded instead.
  if (row.stripe_checkout_session_id) {
    const session = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id);
    if (session.payment_status === "paid") {
      const done = await fulfillPurchase(ctx.admin, stripe, row.id);
      return { purchase: toDTO(done ?? row), checkoutUrl: null };
    }
    // Only when it comes back to the same place (the app, or this web page).
    const returnParam = opts.returnTo ? `&return=${encodeURIComponent(opts.returnTo)}` : null;
    const sameReturn = returnParam
      ? session.success_url?.includes(returnParam) === true
      : session.success_url?.includes("&return=") !== true;
    if (session.status === "open" && session.url && sameReturn) {
      return { purchase: toDTO(row), checkoutUrl: session.url };
    }
  }

  const { data: plan } = await untyped(ctx.admin)
    .from("plans")
    .select("title, description")
    .eq("id", row.plan_id)
    .maybeSingle();
  const url = await openCheckout(
    { ...ctx, stripe },
    row,
    (plan?.title as string | undefined) ?? "Training plan",
    (plan?.description as string | null | undefined) ?? null,
    opts.origin,
    opts.returnTo,
  );
  return { purchase: toDTO((await purchaseRow(ctx.admin, row.id)) ?? row), checkoutUrl: url };
}

export const purchaseListQuery = z.object({
  /** Only purchases in this payment state; `pending` means anything not paid yet. */
  paymentStatus: z.enum(["paid", "pending", "awaiting_coach_setup", "payment_due"]).optional(),
});

const matchesPaymentFilter = (
  row: PurchaseRow,
  filter: z.infer<typeof purchaseListQuery>["paymentStatus"],
): boolean => {
  if (!filter) return true;
  const status = paymentStatusOf(row);
  return filter === "pending" ? status !== "paid" : status === filter;
};

/** Plan titles and coach and athlete names for a set of purchases, by id. */
async function purchaseNames(admin: Admin, rows: PurchaseRow[]) {
  const ids = (pick: (r: PurchaseRow) => string | null) => [
    ...new Set(rows.map(pick).filter((v): v is string => !!v)),
  ];
  const lookup = async (table: string, columns: string, keys: string[]) => {
    if (keys.length === 0) return new Map<string, Record<string, unknown>>();
    const { data, error } = await untyped(admin).from(table).select(columns).in("id", keys);
    if (error) dbError(error);
    return new Map(((data ?? []) as Record<string, unknown>[]).map((r) => [r.id as string, r]));
  };
  const [plans, coaches, athletes] = await Promise.all([
    lookup(
      "plans",
      "id, title",
      ids((r) => r.plan_id),
    ),
    lookup(
      "coach_profiles",
      "id, first_name, last_name",
      ids((r) => r.coach_id),
    ),
    lookup(
      "athletes",
      "id, first_name, last_name",
      ids((r) => r.athlete_id),
    ),
  ]);
  const fullName = (r?: Record<string, unknown>) =>
    r ? [r.first_name, r.last_name].filter(Boolean).join(" ") : null;
  // A buyer is shown to the coach as first name and last initial (athletes are often minors).
  const shortName = (r?: Record<string, unknown>) =>
    r
      ? [r.first_name, r.last_name ? `${String(r.last_name).charAt(0)}.` : null]
          .filter(Boolean)
          .join(" ")
      : null;
  return {
    planTitle: (r: PurchaseRow) =>
      (plans.get(r.plan_id ?? "")?.title as string | undefined) ?? null,
    coachName: (r: PurchaseRow) => fullName(coaches.get(r.coach_id ?? "")),
    athleteName: (r: PurchaseRow) => shortName(athletes.get(r.athlete_id ?? "")),
  };
}

export interface MyPlanPurchaseDTO extends PlanPurchaseDTO {
  planTitle: string | null;
  coachName: string | null;
  /** Who it's for (first name and last initial): the buyer, or a parent's child. */
  athleteName: string | null;
  createdAt: string;
}

/**
 * `GET /api/v1/marketplace/purchases`: the caller's purchases, newest first,
 * delivered or restricted (abandoned checkouts aren't purchases).
 */
export async function listMyPlanPurchases(
  ctx: PurchaseContext,
  query: z.infer<typeof purchaseListQuery>,
  now: Date = new Date(),
): Promise<{ items: MyPlanPurchaseDTO[] }> {
  const { data, error } = await untyped(ctx.admin)
    .from("plan_purchases")
    .select(PURCHASE_COLUMNS)
    .eq("buyer_user_id", ctx.userId)
    .in("status", ["fulfilled", "restricted"])
    .order("created_at", { ascending: false });
  if (error) dbError(error);
  const rows = (await promoteWhenCoachReady(ctx.admin, (data ?? []) as PurchaseRow[])).filter((r) =>
    matchesPaymentFilter(r, query.paymentStatus),
  );
  const names = await purchaseNames(ctx.admin, rows);
  return {
    items: rows.map((r) => ({
      ...toDTO(r, now),
      planTitle: names.planTitle(r),
      coachName: names.coachName(r),
      athleteName: names.athleteName(r),
      createdAt: r.created_at,
    })),
  };
}

export interface CoachSaleDTO extends PlanPurchaseDTO {
  planTitle: string | null;
  /** The athlete it's for, first name and last initial. */
  athleteName: string | null;
  platformFeeCents: number | null;
  stripeFeeCents: number | null;
  /** What reached the coach's Stripe account; null until paid. */
  coachPayoutCents: number | null;
  /** Overdue and not restricted yet: the coach may restrict this buyer. */
  canRestrict: boolean;
  createdAt: string;
}

export interface CoachSalesDTO {
  items: CoachSaleDTO[];
  totals: {
    /** Paid out to the coach (their share of paid sales). */
    receivedCents: number;
    /** Owed by buyers and not paid yet (full prices, before fees). */
    pendingCents: number;
    /** Sales unpaid `PAYMENT_GRACE_DAYS` after becoming due. */
    overdueCount: number;
  };
}

async function callerCoachId(admin: Admin, userId: string): Promise<string> {
  const { data, error } = await admin
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data)
    throw new ApiError({ code: "not_found", status: 404, message: "Coach profile not found." });
  return data.id as string;
}

/**
 * `GET /api/v1/coach/sales`: the caller's plan sales, newest first, with what
 * was received and what's still owed. Totals cover every sale, whatever the
 * filter.
 */
export async function listCoachSales(
  ctx: PurchaseContext,
  query: z.infer<typeof purchaseListQuery>,
  now: Date = new Date(),
): Promise<CoachSalesDTO> {
  const coachId = await callerCoachId(ctx.admin, ctx.userId);
  const { data, error } = await untyped(ctx.admin)
    .from("plan_purchases")
    .select(PURCHASE_COLUMNS)
    .eq("coach_id", coachId)
    .in("status", ["fulfilled", "restricted"])
    .order("created_at", { ascending: false });
  if (error) dbError(error);
  const all = await promoteWhenCoachReady(ctx.admin, (data ?? []) as PurchaseRow[]);

  const totals = { receivedCents: 0, pendingCents: 0, overdueCount: 0 };
  for (const r of all) {
    if (paymentStatusOf(r) === "paid") totals.receivedCents += r.coach_payout_cents ?? 0;
    else if (r.status === "fulfilled") totals.pendingCents += r.amount_cents;
    if (isOverdue(r, now)) totals.overdueCount += 1;
  }

  const rows = all.filter((r) => matchesPaymentFilter(r, query.paymentStatus));
  const names = await purchaseNames(ctx.admin, rows);
  return {
    items: rows.map((r) => ({
      ...toDTO(r, now),
      planTitle: names.planTitle(r),
      athleteName: names.athleteName(r),
      platformFeeCents: r.platform_fee_cents,
      stripeFeeCents: r.stripe_fee_cents,
      coachPayoutCents: r.coach_payout_cents,
      canRestrict: isOverdue(r, now),
      createdAt: r.created_at,
    })),
    totals,
  };
}

/**
 * `POST /api/v1/coach/sales/{id}/restrict`: the coach removes an unpaid
 * buyer's access, only once the sale is overdue (unpaid `PAYMENT_GRACE_DAYS`
 * after payment became due). The athlete's copy of the plan is deleted; the
 * purchase stays in both histories as restricted.
 */
export async function restrictPlanPurchase(
  ctx: PurchaseContext,
  purchaseId: string,
  now: Date = new Date(),
): Promise<PlanPurchaseDTO> {
  const coachId = await callerCoachId(ctx.admin, ctx.userId);
  const row = await purchaseRow(ctx.admin, purchaseId);
  if (!row || row.coach_id !== coachId) throw purchaseNotFound();
  if (row.status === "restricted") return toDTO(row, now);
  if (!isOverdue(row, now)) {
    throw conflict(
      "not_overdue",
      `You can restrict a buyer once their payment is ${PAYMENT_GRACE_DAYS} days overdue.`,
    );
  }
  if (row.copied_plan_id) {
    const moves = await untyped(ctx.admin)
      .from("plan_moves")
      .delete()
      .eq("plan_id", row.copied_plan_id);
    if (moves.error) dbError(moves.error);
    const plan = await untyped(ctx.admin).from("plans").delete().eq("id", row.copied_plan_id);
    if (plan.error) dbError(plan.error);
  }
  const done = await updatePurchase(ctx.admin, row.id, {
    status: "restricted",
    copied_plan_id: null,
    restricted_at: now.toISOString(),
  });
  return toDTO(done, now);
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
