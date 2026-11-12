import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/org-admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/org-admin/coaches", replace: true });
  },
  head: () => ({
    meta: [
      { title: "Coaching · Gradus Club Admin" },
      { name: "description", content: "Club coaching and weekly practice records." },
      { property: "og:title", content: "Coaching · Gradus Club Admin" },
      { property: "og:description", content: "Club coaching and weekly practice records." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
