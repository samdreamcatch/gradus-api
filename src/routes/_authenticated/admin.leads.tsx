import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/admin/stub-page";
import { UserPlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/leads")({
  component: () => (
    <StubPage
      icon={UserPlus}
      title="Waitlist & leads"
      description="Beta parents (no coach yet) and organization leads captured from paywall / onboarding when their club isn't in the system. Sourced from parent_profiles.beta and organization_leads."
    />
  ),
});
