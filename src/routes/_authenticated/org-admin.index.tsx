import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/org-admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/org-admin/resources", replace: true });
  },
  head: () => ({
    meta: [
      { title: "Library · Gradus Club Admin" },
      { name: "description", content: "Club resources and document library." },
      { property: "og:title", content: "Library · Gradus Club Admin" },
      { property: "og:description", content: "Club resources and document library." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
