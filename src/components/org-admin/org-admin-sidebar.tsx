import { Link, useRouterState } from "@tanstack/react-router";
import {
  Users,
  BookOpen,
  Dumbbell,
  FileText,
  CalendarDays,
  Settings,
  Layers,
  ShieldCheck,
  FileSignature,
  Bell,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Eyebrow } from "@/components/ui/eyebrow";
import { useOrgId } from "./org-shared";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getClubNotificationCounts } from "@/lib/club-notifications.functions";

type Item = { to: string; label: string; icon: LucideIcon; exact?: boolean };
type Group = { label: string; items: Item[]; soon?: string[] };

const GROUPS: Group[] = [
  {
    label: "Overview",
    items: [
      { to: "/org-admin", label: "Home", icon: ShieldCheck, exact: true },
      { to: "/org-admin/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Safety",
    items: [
      { to: "/org-admin/policies", label: "Policies", icon: FileSignature },
      { to: "/org-admin/people", label: "People", icon: Users },
    ],
    soon: ["Communications", "Cases"],
  },
  {
    label: "Roster",
    items: [{ to: "/org-admin/roster", label: "Coaches & invites", icon: Users }],
  },
  {
    label: "Content",
    items: [
      { to: "/org-admin/resources", label: "Resource library", icon: BookOpen },
      { to: "/org-admin/moves", label: "Move library", icon: Dumbbell },
      { to: "/org-admin/levels", label: "Levels", icon: Layers },
      { to: "/org-admin/templates", label: "Template plans", icon: FileText },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: "/org-admin/calendar", label: "Club calendar", icon: CalendarDays },
      { to: "/org-admin/settings", label: "Organization", icon: Settings },
    ],
  },
];

export function OrgAdminSidebar() {
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
    i.exact
      ? pathname === i.to || pathname === i.to + "/"
      : pathname === i.to || pathname.startsWith(i.to + "/");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-divider">
        <div className="px-2 py-1">
          <Eyebrow size="small" tone="accent-ink">
            Club
          </Eyebrow>
          <p className="font-display text-h3 text-text-primary leading-tight">
            {orgName || "Gradus Club"}
          </p>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={isActive(item)} tooltip={item.label}>
                        <Link to={item.to as never}>
                          <Icon className="size-4" />
                          <span>{item.label}</span>
                          {item.to === "/org-admin/notifications" &&
                            counts.data &&
                            counts.data.unread > 0 && (
                              <span className="ml-auto font-mono text-xs">
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
                      <span className="font-mono text-nano uppercase">Soon</span>
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
