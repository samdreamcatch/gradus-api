import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/admin/stub-page";
import { Megaphone } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/announcements")({
  component: () => (
    <StubPage
      icon={Megaphone}
      title="Announcements"
      description="Push a system banner to all users (maintenance, new feature) with optional targeting by role."
    />
  ),
});
