import { createFileRoute, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import { DevPreviewGate } from "@/components/payments/dev-preview-gate";
import { PaymentHistoryPage } from "@/components/payments/payment-pages";
import { samplePaymentHistory } from "@/components/payments/payment-samples";

export const Route = createFileRoute("/payment-history-preview")({
  validateSearch: (search: Record<string, unknown>): { payouts?: "setup" } => ({
    payouts: search.payouts === "setup" ? "setup" : undefined,
  }),
  component: PaymentHistoryPreview,
});

function PaymentHistoryPreview() {
  const { payouts } = useSearch({ from: "/payment-history-preview" });
  return (
    <DevPreviewGate>
      <PaymentHistoryPage
        data={samplePaymentHistory(payouts === "setup")}
        onSetUpPayouts={() => toast("Payout setup opens Stripe")}
        onOpenStripe={() => toast("Stripe dashboard opens here")}
        onRestrict={() => toast("Access removed")}
      />
    </DevPreviewGate>
  );
}
