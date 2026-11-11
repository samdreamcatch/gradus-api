/**
 * Web server functions for the payment pages: a coach's payment history
 * (coach settings → Payouts → Payment history) and a buyer's payments
 * (parent / athlete settings → Payments). Thin wrappers over
 * src/lib/plan-purchases.server.ts, the same implementation as
 * `/api/v1/coach/sales` and `/api/v1/marketplace/purchases`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { stripeMoney, type CoachDashboardDTO } from "@/lib/coach-dashboard.server";
import {
  getPlanPurchase,
  listCoachSales,
  listMyPlanPurchases,
  payPlanPurchase,
  restrictPlanPurchase,
  type CoachSalesDTO,
  type MyPlanPurchaseDTO,
  type PlanPurchaseDTO,
} from "@/lib/plan-purchases.server";
import { getStripeConnectStatus, type StripeConnectStatusDTO } from "@/lib/stripe-connect.server";

export interface CoachPaymentHistoryDTO {
  stripe: StripeConnectStatusDTO;
  /** Payouts are on: buyers can pay and the coach's share reaches their Stripe account. */
  payoutsReady: boolean;
  sales: CoachSalesDTO;
  /** Recent bank payouts from their Stripe account; empty before payouts are on. */
  payouts: CoachDashboardDTO["payouts"];
}

export const getCoachPaymentHistoryFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ refresh: z.boolean().default(false) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<CoachPaymentHistoryDTO> => {
    const ctx = { userId: context.userId, admin: supabaseAdmin };
    // Back from Stripe onboarding: ask Stripe first, which also makes waiting purchases due.
    const stripe = await getStripeConnectStatus(ctx, { refresh: data.refresh });
    const sales = await listCoachSales(ctx, {});
    const payoutsReady = stripe.status === "active" && stripe.payoutsEnabled;
    const money =
      payoutsReady && stripe.accountId
        ? await stripeMoney({ userId: context.userId, admin: supabaseAdmin }, stripe.accountId)
        : { payouts: [] };
    return { stripe, payoutsReady, sales, payouts: money.payouts };
  });

/** Removes an overdue buyer's copy of the plan (the coach's restrict). */
export const restrictSaleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ purchaseId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PlanPurchaseDTO> => {
    return restrictPlanPurchase({ userId: context.userId, admin: supabaseAdmin }, data.purchaseId);
  });

export const getMyPaymentsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ items: MyPlanPurchaseDTO[] }> => {
    return listMyPlanPurchases({ userId: context.userId, admin: supabaseAdmin }, {});
  });

/** Back from Stripe Checkout: reads the purchase, which records it once Stripe says it's paid. */
export const confirmMyPaymentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ purchaseId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PlanPurchaseDTO> => {
    return getPlanPurchase({ userId: context.userId, admin: supabaseAdmin }, data.purchaseId);
  });

type PayResult = { checkoutUrl: string | null } | { error: string };

/**
 * "Pay now" on a plan bought before its coach was on Stripe. Stripe Checkout
 * sends the buyer back to `returnTo` on this site (via /purchase/complete).
 */
export const payMyPurchaseFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        purchaseId: z.string().uuid(),
        origin: z.string().url(),
        returnTo: z.enum(["/parent/settings/payments", "/athlete/settings/payments"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<PayResult> => {
    try {
      const res = await payPlanPurchase(
        { userId: context.userId, admin: supabaseAdmin },
        data.purchaseId,
        { origin: new URL(data.origin).origin, returnTo: data.returnTo },
      );
      return { checkoutUrl: res.checkoutUrl };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Couldn't open checkout." };
    }
  });
