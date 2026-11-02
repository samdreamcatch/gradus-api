import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/org-admin/calendar")({
  beforeLoad: () => { throw redirect({ to: "/org-admin/schedule" }); },
});
