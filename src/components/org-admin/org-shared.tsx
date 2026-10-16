import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOrgAdminContext } from "@/lib/org-admin.functions";
import { FilterPill } from "@/components/ui/filter-pill";
import { Card, CardContent } from "@/components/ui/card";
import { sportDisplayLabel } from "@/lib/coach-sports";

/** The club this org admin manages (first one; admins of several clubs are rare). */
export function useOrgId(): { orgId: string | undefined; orgName: string } {
  const ctxFn = useServerFn(getOrgAdminContext);
  const q = useQuery({ queryKey: ["org-admin-ctx"], queryFn: () => ctxFn() });
  const org = q.data?.organizations[0];
  return { orgId: org?.id, orgName: org?.name ?? "" };
}

export function SportFilter({
  sports,
  value,
  onChange,
}: {
  sports: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <FilterPill
      aria-label="Sport"
      className="w-auto min-w-40"
      value={value}
      onValueChange={onChange}
      options={sports.map((s) => ({ value: s, label: sportDisplayLabel(s) }))}
    />
  );
}

export function NoSportsCard() {
  return (
    <Card>
      <CardContent className="p-6 text-sm text-text-secondary">
        Your club doesn't have any sports set up yet. Contact Gradus to add the sports your club
        signed up for.
      </CardContent>
    </Card>
  );
}
