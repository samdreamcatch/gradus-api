import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { openExternal } from "@/lib/browser-actions";
import { getCoachPaymentHistoryFn, restrictSaleFn } from "@/lib/payments.functions";
import {
  openStripeConnectDashboardFn,
  startStripeConnectOnboardingFn,
} from "@/lib/stripe-connect.functions";
import type { CoachSaleDTO } from "@/lib/plan-purchases.server";
import { PaymentHistoryPage } from "./payment-pages";

const QUERY_KEY = ["coach", "payment-history"] as const;

/** `?stripe=return` / `?stripe=refresh`: back from Stripe onboarding started on this page. */
function readStripeReturn(): "return" | "refresh" | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("stripe");
  return value === "return" || value === "refresh" ? value : null;
}

/**
 * Coach settings → Payouts → Payment history: every Marketplace sale, those
 * waiting for the coach to set up payouts, those waiting for the buyer to pay,
 * and those paid, with Stripe bank payouts once connected.
 */
export function CoachPaymentHistory() {
  const queryClient = useQueryClient();
  const getHistory = useServerFn(getCoachPaymentHistoryFn);
  const restrict = useServerFn(restrictSaleFn);
  const startOnboarding = useServerFn(startStripeConnectOnboardingFn);
  const openDashboard = useServerFn(openStripeConnectDashboardFn);
  const [stripeReturn] = useState(readStripeReturn);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: QUERY_KEY,
    // Back from Stripe: ask Stripe now, which also makes waiting purchases due.
    queryFn: () => getHistory({ data: { refresh: stripeReturn !== null } }),
  });

  useEffect(() => {
    if (!stripeReturn) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("stripe");
    window.history.replaceState(window.history.state, "", url.toString());
    if (stripeReturn === "refresh") toast("That Stripe link expired. Tap the button to continue.");
  }, [stripeReturn]);

  useEffect(() => {
    if (isError) toast.error("Couldn't load your payment history. Try again in a moment.");
  }, [isError]);

  const setUpPayouts = async () => {
    setBusy("stripe");
    try {
      const page = `${window.location.origin}/coach/settings/payments`;
      const res = await startOnboarding({
        data: { returnUrl: `${page}?stripe=return`, refreshUrl: `${page}?stripe=refresh` },
      });
      if ("error" in res) toast.error(res.error);
      else void openExternal(res.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open Stripe");
    } finally {
      setBusy(null);
    }
  };

  const openStripe = async () => {
    setBusy("stripe");
    try {
      const res = await openDashboard();
      if ("error" in res) toast.error(res.error);
      else void openExternal(res.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open your Stripe dashboard");
    } finally {
      setBusy(null);
    }
  };

  const removeAccess = async (sale: CoachSaleDTO) => {
    setBusy(sale.id);
    try {
      await restrict({ data: { purchaseId: sale.id } });
      toast.success("Access removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove access.");
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    }
  };

  return (
    <PaymentHistoryPage
      data={data ?? null}
      isLoading={isLoading}
      busy={busy}
      onSetUpPayouts={() => void setUpPayouts()}
      onOpenStripe={() => void openStripe()}
      onRestrict={(sale) => void removeAccess(sale)}
    />
  );
}
