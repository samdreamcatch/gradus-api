/**
 * The marketplace seller dashboard (iOS: Marketplace setup → Seller dashboard).
 *
 * Everything is real data:
 *   - sales, earnings and buyers: plan_purchases, through `listCoachSales`
 *     (src/lib/plan-purchases.server.ts), so the dashboard and the sales list
 *     always agree;
 *   - views and conversion: plans.view_count and plan_views (migration
 *     20261111121100_plan_views), recorded by `recordPlanView` when someone
 *     other than the coach opens a plan's marketplace page;
 *   - money on the way to the coach's bank and their bank payouts: their
 *     Stripe Connect account (balance and payouts), when they're connected.
 *   - promo codes: how many of the coach's codes are usable now, of all
 *     they have (src/lib/coach-promo-codes.server.ts).
 */
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { promoCodeCounts } from "./coach-promo-codes.server";
import { dbError } from "./db-error";
import { listCoachSales, type CoachSaleDTO } from "./plan-purchases.server";
import { createConnectStripeClient } from "./stripe-connect.server";

type Admin = SupabaseClient<Database>;

// The generated types don't know the marketplace columns and tables yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Untyped = { from: (table: string) => any };
const untyped = (client: Admin) => client as unknown as Untyped;

/** The Stripe calls the dashboard makes on the coach's connected account; tests pass a fake. */
export type DashboardStripe = {
  balance: Pick<Stripe["balance"], "retrieve">;
  payouts: Pick<Stripe["payouts"], "list">;
};

export type DashboardContext = {
  userId: string;
  admin: Admin;
  /** Defaults to the platform client; null skips Stripe (no balance or payouts). */
  stripe?: DashboardStripe | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Months of earnings returned at least (1Y and the year before), and weeks in the performance breakdown. */
const TREND_MONTHS = 24;
const PERFORMANCE_WEEKS = 6;

/* --------------------------------------------------------------- views */

/**
 * `POST /api/v1/marketplace/plans/{id}/view`: someone opened a plan's
 * marketplace page. Counted once per person per plan per day, and never for
 * the plan's own coach. Returns the plan's view total.
 */
export async function recordPlanView(
  ctx: { userId: string; admin: Admin },
  planId: string,
  today: Date = new Date(),
): Promise<{ counted: boolean; viewCount: number }> {
  const { data: plan, error } = await untyped(ctx.admin)
    .from("plans")
    .select("id, status, view_count, coach:coach_profiles!inner(user_id)")
    .eq("id", planId)
    .maybeSingle();
  if (error) dbError(error);
  if (!plan || plan.status !== "active") {
    throw new ApiError({ code: "not_found", status: 404, message: "Plan not found." });
  }
  if (plan.coach.user_id === ctx.userId) {
    return { counted: false, viewCount: plan.view_count ?? 0 };
  }

  const viewedOn = today.toISOString().slice(0, 10);
  const { data: inserted, error: insertError } = await untyped(ctx.admin)
    .from("plan_views")
    .upsert(
      { plan_id: planId, viewer_user_id: ctx.userId, viewed_on: viewedOn },
      { onConflict: "plan_id,viewer_user_id,viewed_on", ignoreDuplicates: true },
    )
    .select("id");
  if (insertError) dbError(insertError);
  if (!inserted?.length) return { counted: false, viewCount: plan.view_count ?? 0 };

  // The total is recounted from the log, so two views at once can't lose one.
  const { count, error: countError } = await untyped(ctx.admin)
    .from("plan_views")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", planId);
  if (countError) dbError(countError);
  const viewCount = count ?? (plan.view_count ?? 0) + 1;
  const { error: updateError } = await untyped(ctx.admin)
    .from("plans")
    .update({ view_count: viewCount })
    .eq("id", planId);
  if (updateError) dbError(updateError);
  return { counted: true, viewCount };
}

/* ----------------------------------------------------------- dashboard */

export interface CoachDashboardDTO {
  /** Stripe payouts are set up (balance and payouts below are from Stripe). */
  connected: boolean;
  totals: {
    /** Plans sold (delivered or restricted). */
    salesCount: number;
    /** The coach's share of paid sales. */
    earnedCents: number;
    /** Owed by buyers and not paid yet (pay later). */
    pendingCents: number;
    /**
     * "On the way": plans delivered before the coach was on Stripe and not
     * paid yet, at their full price. The money comes once those buyers pay.
     */
    onTheWayCents: number;
    /** In the coach's Stripe balance, not in their bank yet; null when not connected or Stripe didn't answer. */
    stripeBalanceCents: number | null;
    /**
     * "Paid out": everything the coach has received, their share of paid sales
     * transferred to their Stripe account (same as earnedCents).
     */
    paidOutCents: number;
    /** Marketplace views of the coach's plans. */
    views: number;
    /** Sales per view (0–1); null with no views. */
    conversion: number | null;
    /** Across the coach's plans, weighted by rating count; null with no ratings. */
    ratingAverage: number | null;
    ratingCount: number;
    overdueCount: number;
  };
  /** The coach's share of paid sales per month, oldest first (`month` is YYYY-MM). */
  monthlyEarnings: { month: string; cents: number }[];
  /** Newest first. */
  sales: CoachSaleDTO[];
  /**
   * The coach's products, newest first: every active plan (what the
   * marketplace lists) and their unpublished plans and templates.
   */
  plans: {
    id: string;
    title: string;
    priceCents: number;
    status: string;
    soldCount: number;
    views: number;
  }[];
  /** Views and sales per week, newest first (`weekStart`, `weekEnd` are YYYY-MM-DD, Monday to Sunday). */
  weekly: { weekStart: string; weekEnd: string; views: number; sales: number }[];
  /** Payouts to the coach's bank, newest first; empty when not connected. */
  payouts: {
    id: string;
    arrivalDate: string;
    amountCents: number;
    status: string;
    bankLast4: string | null;
  }[];
  /** The coach's promo codes: usable now, of all they have. */
  promoCodes: { active: number; total: number };
}

type PlanRow = {
  id: string;
  title: string;
  price: number | string | null;
  status: string;
  view_count: number | null;
  rating_avg: number | string | null;
  rating_count: number | null;
  created_at: string;
};

/** Monday 00:00 UTC of `d`'s week. */
function weekStart(d: Date): Date {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * DAY_MS);
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * `GET /api/v1/coach/marketplace/dashboard`: the caller's seller dashboard.
 * Stripe balance and payouts are best effort: if Stripe doesn't answer, those
 * figures are null and the rest still loads.
 */
export async function getCoachDashboard(
  ctx: DashboardContext,
  now: Date = new Date(),
): Promise<CoachDashboardDTO> {
  const { data: coach, error } = await untyped(ctx.admin)
    .from("coach_profiles")
    .select(
      "id, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled",
    )
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!coach) {
    throw new ApiError({ code: "not_found", status: 404, message: "Coach profile not found." });
  }

  const [sales, plansRes, ratedRes, promoCodes] = await Promise.all([
    listCoachSales({ userId: ctx.userId, admin: ctx.admin }, {}, now),
    untyped(ctx.admin)
      .from("plans")
      .select("id, title, price, status, view_count, rating_avg, rating_count, created_at")
      .eq("coach_id", coach.id)
      // Live: every active plan, as the marketplace lists them (assigned ones included).
      // Drafts: the unpublished plans and templates the coach is building (no athlete).
      .or("status.eq.active,athlete_id.is.null")
      .order("created_at", { ascending: false }),
    // The coach's rating covers every plan of theirs, assigned ones included.
    untyped(ctx.admin)
      .from("plans")
      .select("rating_avg, rating_count")
      .eq("coach_id", coach.id)
      .gt("rating_count", 0),
    promoCodeCounts(ctx.admin, coach.id, now),
  ]);
  if (plansRes.error) dbError(plansRes.error);
  if (ratedRes.error) dbError(ratedRes.error);
  const plans = (plansRes.data ?? []) as PlanRow[];

  // Weekly views of the coach's plans, from plan_views.
  const firstWeek = new Date(weekStart(now).getTime() - (PERFORMANCE_WEEKS - 1) * 7 * DAY_MS);
  const viewsByDay: { viewed_on: string }[] = [];
  if (plans.length) {
    const { data: views, error: viewsError } = await untyped(ctx.admin)
      .from("plan_views")
      .select("viewed_on")
      .in(
        "plan_id",
        plans.map((p) => p.id),
      )
      .gte("viewed_on", isoDate(firstWeek));
    if (viewsError) dbError(viewsError);
    viewsByDay.push(...((views ?? []) as { viewed_on: string }[]));
  }

  const weekly = Array.from({ length: PERFORMANCE_WEEKS }, (_, i) => {
    const start = new Date(weekStart(now).getTime() - i * 7 * DAY_MS);
    const end = new Date(start.getTime() + 6 * DAY_MS);
    const [from, to] = [isoDate(start), isoDate(end)];
    return {
      weekStart: from,
      weekEnd: to,
      views: viewsByDay.filter((v) => v.viewed_on >= from && v.viewed_on <= to).length,
      sales: sales.items.filter((s) => {
        const day = s.createdAt.slice(0, 10);
        return day >= from && day <= to;
      }).length,
    };
  });

  // Two years (1Y and the year before it), or back to the first paid sale for All.
  const paidMonth = (s: CoachSaleDTO) => (s.paidAt ?? s.createdAt).slice(0, 7);
  const paid = sales.items.filter((s) => s.paymentStatus === "paid");
  const thisMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const firstPaid = paid.reduce<number>((min, s) => {
    const [y, m] = paidMonth(s).split("-").map(Number);
    return Math.min(min, y * 12 + (m - 1));
  }, thisMonth);
  const trendMonths = Math.max(TREND_MONTHS, thisMonth - firstPaid + 1);
  const monthlyEarnings = Array.from({ length: trendMonths }, (_, i) => {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (trendMonths - 1 - i), 1),
    );
    const month = d.toISOString().slice(0, 7);
    const cents = paid
      .filter((s) => paidMonth(s) === month)
      .reduce((sum, s) => sum + (s.coachPayoutCents ?? 0), 0);
    return { month, cents };
  });

  const soldByPlan = new Map<string, number>();
  for (const s of sales.items) {
    if (s.planId) soldByPlan.set(s.planId, (soldByPlan.get(s.planId) ?? 0) + 1);
  }
  let ratingWeighted = 0;
  let ratingCount = 0;
  for (const p of (ratedRes.data ?? []) as Pick<PlanRow, "rating_avg" | "rating_count">[]) {
    const n = p.rating_count ?? 0;
    if (n > 0 && p.rating_avg !== null) {
      ratingWeighted += Number(p.rating_avg) * n;
      ratingCount += n;
    }
  }
  const views = plans.reduce((sum, p) => sum + (p.view_count ?? 0), 0);

  const connected =
    !!coach.stripe_connect_account_id &&
    coach.stripe_connect_charges_enabled === true &&
    coach.stripe_connect_payouts_enabled === true;
  const money = connected
    ? await stripeMoney(ctx, coach.stripe_connect_account_id as string)
    : { stripeBalanceCents: null, payouts: [] };
  // Bought before the coach was on Stripe and still unpaid (awaiting setup, or due since).
  const onTheWayCents = sales.items
    .filter(
      (s) =>
        s.status === "fulfilled" &&
        (s.paymentStatus === "awaiting_coach_setup" ||
          s.paymentStatus === "payment_due" ||
          s.paymentStatus === "processing"),
    )
    .reduce((sum, s) => sum + s.amountCents, 0);

  return {
    connected,
    totals: {
      salesCount: sales.items.length,
      earnedCents: sales.totals.receivedCents,
      pendingCents: sales.totals.pendingCents,
      onTheWayCents,
      stripeBalanceCents: money.stripeBalanceCents,
      paidOutCents: sales.totals.receivedCents,
      views,
      conversion: views > 0 ? Math.round((sales.items.length / views) * 1000) / 1000 : null,
      ratingAverage:
        ratingCount > 0 ? Math.round((ratingWeighted / ratingCount) * 100) / 100 : null,
      ratingCount,
      overdueCount: sales.totals.overdueCount,
    },
    monthlyEarnings,
    sales: sales.items,
    plans: plans.map((p) => ({
      id: p.id,
      title: p.title,
      priceCents: Math.round(Number(p.price ?? 0) * 100),
      status: p.status,
      soldCount: soldByPlan.get(p.id) ?? 0,
      views: p.view_count ?? 0,
    })),
    weekly,
    payouts: money.payouts,
    promoCodes,
  };
}

/** The coach's Stripe balance (not in their bank yet) and recent bank payouts; nulls if Stripe fails. */
export async function stripeMoney(
  ctx: DashboardContext,
  accountId: string,
): Promise<{
  stripeBalanceCents: number | null;
  payouts: CoachDashboardDTO["payouts"];
}> {
  if (ctx.stripe === null) return { stripeBalanceCents: null, payouts: [] };
  try {
    const stripe = ctx.stripe ?? createConnectStripeClient();
    const [balance, payouts] = await Promise.all([
      stripe.balance.retrieve({}, { stripeAccount: accountId }),
      stripe.payouts.list(
        { limit: 20, expand: ["data.destination"] },
        { stripeAccount: accountId },
      ),
    ]);
    const sum = (rows: { amount: number }[] | undefined) =>
      (rows ?? []).reduce((total, r) => total + r.amount, 0);
    return {
      stripeBalanceCents: sum(balance.available) + sum(balance.pending),
      payouts: payouts.data.map((p) => {
        const bank = typeof p.destination === "object" && p.destination ? p.destination : null;
        return {
          id: p.id,
          arrivalDate: new Date(p.arrival_date * 1000).toISOString().slice(0, 10),
          amountCents: p.amount,
          status: p.status,
          bankLast4: bank && "last4" in bank ? (bank.last4 as string) : null,
        };
      }),
    };
  } catch (e) {
    console.error("[dashboard] Stripe balance/payouts failed", e);
    return { stripeBalanceCents: null, payouts: [] };
  }
}
