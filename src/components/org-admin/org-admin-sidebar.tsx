import { Link, useRouterState } from "@tanstack/react-router";
import {
  Users,
  BookOpen,
  Dumbbell,
  FileText,
  CalendarDays,
  Settings,
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

type Item = { to: string; label: string; icon: LucideIcon };
type Group = { label: string; items: Item[] };

const GROUPS: Group[] = [
  {
    label: "Roster",
    items: [{ to: "/org-admin/roster", label: "Coaches & invites", icon: Users }],
  },
  {
    label: "Content",
    items: [
      { to: "/org-admin/resources", label: "Resource library", icon: BookOpen },
      { to: "/org-admin/moves", label: "Move library", icon: Dumbbell },
      { to: "/org-admin/templates", label: "Template plans", icon: FileText },
    ],
  },
  {
    label: "Schedule",
    items: [{ to: "/org-admin/calendar", label: "Club calendar", icon: CalendarDays }],
  },
  {
    label: "Settings",
    items: [{ to: "/org-admin/settings", label: "Organization", icon: Settings }],
  },
];

export function OrgAdminSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-divider">
        <div className="px-2 py-1">
          <Eyebrow size="small" tone="accent-ink">Club</Eyebrow>
          <p className="font-display text-h3 text-text-primary leading-tight">
            Organization Admin
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
                  const active = isActive(item.to);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link to={item.to as any}>
                          <Icon className="size-4" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
