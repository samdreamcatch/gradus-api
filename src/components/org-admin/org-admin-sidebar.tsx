import { Link, useRouterState } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useOrgId } from "./org-shared";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getClubNotificationCounts } from "@/lib/club-notifications.functions";

type Item = { to: string; label: string; exact?: boolean };
type Group = { label: string; items: Item[]; soon?: string[] };

const GROUPS: Group[] = [
  {
    label: "Club",
    items: [
      { to: "/org-admin/coaches", label: "Coaching" },
      { to: "/org-admin/resources", label: "Library" },
      { to: "/org-admin/schedule", label: "Schedule" },
      { to: "/org-admin/people", label: "Users" },
      { to: "/org-admin/notifications", label: "Notifications" },
      { to: "/org-admin/settings", label: "Settings" },
    ],
  },
];

export function OrgAdminSidebar({ onSignOut }: { onSignOut: () => void | Promise<void> }) {
  const { orgId, orgName } = useOrgId();
  const countFn = useServerFn(getClubNotificationCounts);
  const counts = useQuery({
    queryKey: ["club-notification-counts", orgId],
    queryFn: () => {
      if (!orgId) throw new Error("No club selected");
      return countFn({ data: { organizationId: orgId } });
    },
    enabled: !!orgId,
    retry: false,
    staleTime: 60_000,
  });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (i: Item) =>
    i.label === "Library" &&
    ["resources", "policies", "moves", "levels", "templates", "builder"].some((section) =>
      pathname.startsWith(`/org-admin/${section}`),
    )
      ? true
      : i.exact
        ? pathname === i.to || pathname === i.to + "/"
        : pathname === i.to || pathname.startsWith(i.to + "/");

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="shrink-0 px-4 py-6">
        <div className="min-w-0 px-2 py-1">
          <p className="truncate font-display text-h3 text-text-primary leading-tight">
            {orgName || "Gradus Club"}
          </p>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  return (
                    <SidebarMenuItem key={item.to}>
                      {item.label === "Settings" && (
                        <SidebarMenuButton
                          disabled
                          tooltip="Storefront · not connected"
                          className="mb-1 min-h-11 font-sans"
                        >
                          <span>Storefront</span>
                          <span className="ml-auto font-sans text-xs text-text-tertiary">
                            Not connected
                          </span>
                        </SidebarMenuButton>
                      )}
                      <SidebarMenuButton
                        asChild
                        isActive={isActive(item)}
                        tooltip={item.label}
                        className="min-h-11 font-sans data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-semibold"
                      >
                        <Link to={item.to as never}>
                          <span>{item.label}</span>
                          {item.to === "/org-admin/notifications" &&
                            counts.data &&
                            counts.data.unread > 0 && (
                              <span className="ml-auto font-sans text-xs">
                                {counts.data.unread}
                              </span>
                            )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
                {group.soon?.map((label) => (
                  <SidebarMenuItem key={label}>
                    <div className="flex items-center justify-between px-2 py-1.5 text-sm text-text-tertiary group-data-[collapsible=icon]:hidden">
                      <span>{label}</span>
                      <span className="font-sans text-xs text-text-tertiary">Soon</span>
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="p-4">
        <Button
          variant="ghost"
          onClick={onSignOut}
          className="min-h-11 justify-start font-sans text-text-primary"
          title="Sign out"
        >
          Sign out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
