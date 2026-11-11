import { createFileRoute } from "@tanstack/react-router";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { BuyerPayments } from "@/components/payments/buyer-payments";

export const Route = createFileRoute("/_authenticated/parent/settings_/payments")({
  head: () => ({
    meta: [
      { title: "Payments — Gradus" },
      { name: "description", content: "Plans you bought, payments due, and your receipts." },
    ],
  }),
  component: () => (
    <>
      <div className="pb-app-chrome">
        <BuyerPayments role="parent" />
      </div>
      <ParentBottomNav />
    </>
  ),
});
