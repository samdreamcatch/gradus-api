import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { DevPreviewGate } from "@/components/payments/dev-preview-gate";
import { PaymentsPage } from "@/components/payments/payment-pages";
import { samplePurchases } from "@/components/payments/payment-samples";

export const Route = createFileRoute("/payments-preview")({
  component: () => (
    <DevPreviewGate>
      <PaymentsPage
        items={samplePurchases}
        plansPath={() => "#"}
        onPay={() => toast("Checkout opens here")}
      />
    </DevPreviewGate>
  ),
});
