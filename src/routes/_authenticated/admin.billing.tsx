import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/admin/stub-page";
import { CreditCard } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/billing")({
  component: () => (
    <StubPage
      icon={CreditCard}
      title="Billing"
      description="Active Coach / Coach Pro / Club subscriptions, MRR, recent Stripe events, failed payments, prorated refunds from club joins."
    />
  ),
});
