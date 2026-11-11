import { createFileRoute } from "@tanstack/react-router";
import { CoachBottomNav } from "@/components/coach/bottom-nav";
import { CoachPaymentHistory } from "@/components/payments/coach-payment-history";

export const Route = createFileRoute("/_authenticated/coach/settings_/payments")({
  head: () => ({
    meta: [
      { title: "Payment history — Gradus" },
      {
        name: "description",
        content: "Your Marketplace sales, what buyers still owe, and your payouts.",
      },
    ],
  }),
  component: () => (
    <>
      <div className="pb-app-chrome">
        <CoachPaymentHistory />
      </div>
      <CoachBottomNav />
    </>
  ),
});
