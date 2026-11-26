import { createFileRoute, redirect } from "@tanstack/react-router";

// Coaches and invitations now live in the single Users table.
export const Route = createFileRoute("/_authenticated/org-admin/roster")({
  beforeLoad: () => {
    throw redirect({ to: "/org-admin/people", search: { tab: "coaches", invite: true } });
  },
});
