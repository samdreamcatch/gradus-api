import { Link, useRouterState } from "@tanstack/react-router";
import {
  Timer,
  Users,
  Network,
  Ticket,
  UserPlus,
  UserCheck,
  BarChart3,
  ClipboardList,
  History,
  Building2,
  Trophy,
  CreditCard,
  MessageSquare,
  AlertTriangle,
  Mail,
  MailCheck,
  MailPlus,
  Megaphone,
  Share2,
  Sparkles,
  ShieldAlert,
  type LucideIcon,
  BookOpen,
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

type Item = { to: string; label: string; icon: LucideIcon; exact?: boolean };
type Group = { label: string; items: Item[] };

const GROUPS: Group[] = [
  {
    label: "Reporting",
    items: [
      { to: "/admin/reporting", label: "Overview", icon: BarChart3 },
      { to: "/admin/usage", label: "App usage", icon: Timer },
      { to: "/admin/ask", label: "Ask the data", icon: Sparkles },
      { to: "/admin/active", label: "Active users", icon: UserCheck },
      { to: "/admin/sessions", label: "Sessions", icon: ClipboardList },
      { to: "/admin/activity", label: "Activity log", icon: History },
    ],
  },
  {
    label: "Membership",
    items: [
      { to: "/admin/users", label: "Users", icon: Users },
      { to: "/admin/map", label: "Connection map", icon: Network },
      { to: "/admin/promo-codes", label: "Promo codes", icon: Ticket },
      { to: "/admin/parent-invites", label: "Parent invites", icon: MailPlus },
      { to: "/admin/leads", label: "Waitlist & leads", icon: UserPlus },
      { to: "/admin/impersonation", label: "Impersonation", icon: UserCheck },
    ],
  },
  {
    label: "Competitions",
    items: [{ to: "/admin/competitions", label: "Live boards", icon: Trophy }],
  },
  {
    label: "Organizations",
    items: [{ to: "/admin/organizations", label: "Organizations & codes", icon: Building2 }],
  },
  {
    label: "Revenue",
    items: [{ to: "/admin/billing", label: "Billing", icon: CreditCard }],
  },
  {
    label: "Content",
    items: [
      { to: "/admin/social-plans", label: "Social plans", icon: Share2 },
      { to: "/admin/knowledge", label: "Knowledge corpus", icon: BookOpen },
    ],
  },
  {
    label: "Trust & safety",
    items: [{ to: "/admin/reports", label: "Reports", icon: ShieldAlert }],
  },
  {
    label: "Support",

    items: [
      { to: "/admin/feedback", label: "Feedback", icon: MessageSquare },
      { to: "/admin/errors", label: "Errors", icon: AlertTriangle },
      { to: "/admin/emails", label: "Email copy", icon: Mail },
      { to: "/admin/email-health", label: "Email deliverability", icon: MailCheck },
      { to: "/admin/announcements", label: "Announcements", icon: Megaphone },
    ],
  },
];

export function AdminSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(to + "/");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-divider">
        <div className="px-2 py-1">
          <Eyebrow size="small" tone="accent-ink">
            Internal
          </Eyebrow>
          <p className="font-display text-h3 text-text-primary leading-tight">Admin</p>
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
                  const active = isActive(item.to, item.exact);
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
