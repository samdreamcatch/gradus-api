import { queryOptions } from "@tanstack/react-query";
import { getOrgAdminContext, listOrgRoster } from "@/lib/org-admin.functions";

export const clubCoachesOptions = () => queryOptions({
  queryKey: ["club-coaches-directory"],
  queryFn: async () => {
    const context = await getOrgAdminContext();
    const org = context.organizations[0];
    if (!org) throw new Error("No club is available for this account.");
    const roster = await listOrgRoster({ data: { organizationId: org.id } });
    return { org, coaches: roster.coaches };
  },
});