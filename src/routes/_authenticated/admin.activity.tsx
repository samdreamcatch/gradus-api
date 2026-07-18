import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/admin/stub-page";
import { History } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/activity")({
  component: () => (
    <StubPage
      icon={History}
      title="Activity log"
      description="Timeline of admin actions: test-flag toggles, promo edits, role grants, impersonation events, plan changes."
    />
  ),
});
