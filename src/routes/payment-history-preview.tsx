import { createFileRoute, useSearch } from "@tanstack/react-router";
import { DevPreviewGate } from "@/components/payments/dev-preview-gate";
import { PaymentHistoryPage } from "@/components/payments/mock-payment-pages";

export const Route = createFileRoute("/payment-history-preview")({
  validateSearch: (search: Record<string, unknown>): { payouts?: "setup" } => ({
    payouts: search.payouts === "setup" ? "setup" : undefined,
  }),
  component: PaymentHistoryPreview,
});

function PaymentHistoryPreview() {
  const { payouts } = useSearch({ from: "/payment-history-preview" });
  return <DevPreviewGate><PaymentHistoryPage payoutsSetup={payouts === "setup"} /></DevPreviewGate>;
}
