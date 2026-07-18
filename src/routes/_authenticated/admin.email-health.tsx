import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/admin/stub-page";
import { MailCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/email-health")({
  component: () => (
    <StubPage
      icon={MailCheck}
      title="Email deliverability"
      description="Bounces, suppressions, and recent sends. Sourced from email_send_log and suppressed_emails."
    />
  ),
});
