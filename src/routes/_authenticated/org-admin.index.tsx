import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/org-admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/org-admin/schedule", replace: true });
  },
  head: () => ({
    meta: [
      { title: "Schedule · Gradus Club Admin" },
      { name: "description", content: "Club lesson schedule and invitations." },
      { property: "og:title", content: "Schedule · Gradus Club Admin" },
      { property: "og:description", content: "Club lesson schedule and invitations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
