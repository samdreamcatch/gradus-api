import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { openExternal } from "@/lib/native";
import { confirmMyPaymentFn, getMyPaymentsFn, payMyPurchaseFn } from "@/lib/payments.functions";
import type { MyPlanPurchaseDTO } from "@/lib/plan-purchases.server";
import { PaymentsPage } from "./payment-pages";

const QUERY_KEY = ["me", "payments"] as const;

/** `?purchase=<id>[&canceled=1]`: back from Stripe Checkout (via /purchase/complete). */
function readCheckoutReturn(): { purchaseId: string; canceled: boolean } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const purchaseId = params.get("purchase");
  return purchaseId ? { purchaseId, canceled: params.get("canceled") === "1" } : null;
}

/**
 * Parent / athlete settings → Payments: the plans they bought, what's still to
 * pay (plans bought before the coach was on Stripe), and a receipt for each
 * paid one. Paying opens Stripe Checkout, which comes back here.
 */
export function BuyerPayments({ role }: { role: "parent" | "athlete" }) {
  const queryClient = useQueryClient();
  const getPayments = useServerFn(getMyPaymentsFn);
  const confirm = useServerFn(confirmMyPaymentFn);
  const pay = useServerFn(payMyPurchaseFn);
  const [checkoutReturn] = useState(readCheckoutReturn);
  const [payingId, setPayingId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      // Back from a paid checkout: record it before listing, so it shows as paid.
      if (checkoutReturn && !checkoutReturn.canceled) {
        await confirm({ data: { purchaseId: checkoutReturn.purchaseId } }).catch(() => null);
      }
      return getPayments();
    },
  });

  useEffect(() => {
    if (!checkoutReturn) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("purchase");
    url.searchParams.delete("canceled");
    window.history.replaceState(window.history.state, "", url.toString());
    toast(
      checkoutReturn.canceled
        ? "Checkout canceled. You weren't charged."
        : "Thanks! Your payment is recorded.",
    );
  }, [checkoutReturn]);

  useEffect(() => {
    if (isError) toast.error("Couldn't load your payments. Try again in a moment.");
  }, [isError]);

  const startPayment = async (purchase: MyPlanPurchaseDTO) => {
    setPayingId(purchase.id);
    try {
      const res = await pay({
        data: {
          purchaseId: purchase.id,
          origin: window.location.origin,
          returnTo: `/${role}/settings/payments`,
        },
      });
      if ("error" in res) toast.error(res.error);
      else if (res.checkoutUrl) void openExternal(res.checkoutUrl);
      else toast.success("This plan is already paid for.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open checkout.");
    } finally {
      setPayingId(null);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    }
  };

  return (
    <PaymentsPage
      items={data?.items ?? []}
      isLoading={isLoading}
      payingId={payingId}
      plansPath={(planId) => `/${role}/plans/${planId}`}
      onPay={(purchase) => void startPayment(purchase)}
    />
  );
}
