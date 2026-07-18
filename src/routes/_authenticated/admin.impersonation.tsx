import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/admin/stub-page";
import { UserCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/impersonation")({
  component: () => (
    <StubPage
      icon={UserCheck}
      title="Impersonation"
      description="Read-only 'view as user' sessions for debugging support tickets. All impersonation events are audit-logged."
    />
  ),
});
