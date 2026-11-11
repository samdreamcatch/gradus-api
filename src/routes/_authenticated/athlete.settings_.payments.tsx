import { createFileRoute } from "@tanstack/react-router";
import { AthleteBottomNav } from "@/components/athlete/bottom-nav";
import { BuyerPayments } from "@/components/payments/buyer-payments";

export const Route = createFileRoute("/_authenticated/athlete/settings_/payments")({
  head: () => ({
    meta: [
      { title: "Payments — Gradus" },
      { name: "description", content: "Plans you bought, payments due, and your receipts." },
    ],
  }),
  component: () => (
    <>
      <div className="pb-app-chrome">
        <BuyerPayments role="athlete" />
      </div>
      <AthleteBottomNav />
    </>
  ),
});
