import { createFileRoute } from "@tanstack/react-router";
import { PageTitle } from "@/components/page-title";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/org-admin/resources")({
  component: () => (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl">
      <PageTitle title="Resource library" description="Club-wide default resources" />
      <Card><CardContent className="p-6 text-sm text-text-secondary">Coming soon.</CardContent></Card>
    </div>
  ),
});
