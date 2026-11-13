import { Link, useRouterState } from "@tanstack/react-router";
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

export function OrgAdminNavigation({ onSignOut }: { onSignOut: () => void | Promise<void> }) {
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
    <header className="w-full min-w-0 border-b border-divider bg-card px-4 sm:px-6">
      <div className="flex min-w-0 items-center justify-between gap-4 py-2">
          <p className="truncate font-display text-h3 text-text-primary leading-tight">
            {orgName || "Gradus Club"}
          </p>
        <Button variant="ghost" onClick={onSignOut} className="min-h-11 shrink-0 font-sans text-text-primary" title="Sign out">
          Sign out
        </Button>
      </div>
      <nav aria-label="Club menu" className="flex min-w-0 gap-1 overflow-x-auto pb-2">
        {GROUPS.map((group) => (
          <div key={group.label} className="flex shrink-0 items-center gap-1">
                {group.items.map((item) => {
                  return (
                    <div key={item.to} className="flex shrink-0 items-center gap-1">
                      {item.label === "Settings" && (
                        <Button variant="ghost"
                          disabled
                          title="Storefront · not connected"
                          className="min-h-11 font-sans"
                        >
                          <span>Storefront</span>
                          <span className="font-sans text-xs text-text-tertiary">
                            Not connected
                          </span>
                        </Button>
                      )}
                      <Button variant="ghost"
                        asChild
                        className={`min-h-11 font-sans ${isActive(item) ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold" : "text-text-secondary"}`}
                      >
                        <Link to={item.to as never} aria-current={isActive(item) ? "page" : undefined}>
                          <span>{item.label}</span>
                          {item.to === "/org-admin/notifications" &&
                            counts.data &&
                            counts.data.unread > 0 && (
                              <span className="font-mono text-xs">
                                {counts.data.unread}
                              </span>
                            )}
                        </Link>
                      </Button>
                    </div>
                  );
                })}
          </div>
        ))}
      </nav>
    </header>
  );
}
