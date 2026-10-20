import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOrgAdminContext } from "@/lib/org-admin.functions";
import { PageTitle } from "@/components/page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/org-admin/settings")({
  component: OrgSettings,
});

function OrgSettings() {
  const ctxFn = useServerFn(getOrgAdminContext);
  const ctxQ = useQuery({ queryKey: ["org-admin-ctx"], queryFn: () => ctxFn() });
  const org = ctxQ.data?.organizations[0];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl">
      <PageTitle>Organization</PageTitle>
      <Card>
        <CardHeader>
          <CardTitle>{org?.name ?? "—"}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-text-secondary space-y-1">
          <div>{[org?.city, org?.region].filter(Boolean).join(", ") || "—"}</div>
        </CardContent>
      </Card>
    </div>
  );
}
