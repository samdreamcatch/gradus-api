import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/org-admin/coaches/")({
  beforeLoad: () => { throw redirect({ to: "/org-admin/people", replace: true }); },
  head: () => ({ meta: [
    { title: "Coach records · Gradus Club" },
    { name: "description", content: "Coach records are available in the club Users table." },
    { property: "og:title", content: "Coach records · Gradus Club" },
    { property: "og:description", content: "Coach records are available in the club Users table." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
});
