import { createFileRoute } from "@tanstack/react-router";
import { PageTitle } from "@/components/page-title";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/org-admin/templates")({
  head: () => ({ meta: [
    { title: "Template plans · Gradus Club" },
    { name: "description", content: "Club template-plan workspace." },
    { property: "og:title", content: "Template plans · Gradus Club" },
    { property: "og:description", content: "Club template-plan workspace." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: () => (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl">
      <PageTitle>Template plans</PageTitle>
      <Card>
        <CardContent className="p-6 text-sm text-text-secondary">Coming soon.</CardContent>
      </Card>
    </div>
  ),
});
