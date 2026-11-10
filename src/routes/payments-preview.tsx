import { createFileRoute } from "@tanstack/react-router";
import { DevPreviewGate } from "@/components/payments/dev-preview-gate";
import { PaymentsPage } from "@/components/payments/mock-payment-pages";

export const Route = createFileRoute("/payments-preview")({
  component: () => <DevPreviewGate><PaymentsPage /></DevPreviewGate>,
});
