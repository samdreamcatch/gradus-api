import { Link, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useOrgId } from "./org-shared";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getClubNotificationCounts } from "@/lib/club-notifications.functions";
import { ClubNotificationTray } from "./club-notification-tray";

type Item = { to: string; label: string; exact?: boolean };
const ITEMS: Item[] = [
  { to: "/org-admin/schedule", label: "Schedule" },
  { to: "/org-admin/people", label: "Users" },
  { to: "/org-admin/resources", label: "Library" },
  { to: "/org-admin/settings", label: "Settings" },
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
    i.label === "Users" && pathname.startsWith("/org-admin/coaches/") ? true :
    i.label === "Library" &&
    ["resources", "policies", "moves", "levels", "templates", "builder"].some((section) =>
      pathname.startsWith(`/org-admin/${section}`),
    )
      ? true
      : i.exact
        ? pathname === i.to || pathname === i.to + "/"
        : pathname === i.to || pathname.startsWith(i.to + "/");

  return (
    <header className="sticky top-0 z-30 w-full min-w-0 border-b border-divider bg-popover">
      <div className="mx-auto grid w-full max-w-7xl min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 md:px-6 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:gap-x-5">
        <p
          title={orgName || "Gradus Club"}
          className="max-w-56 truncate py-3 font-sans text-base font-semibold leading-tight text-text-primary lg:max-w-40 lg:border-r lg:border-divider lg:pr-5"
        >
          {orgName || "Gradus Club"}
        </p>
        <nav
          aria-label="Club menu"
          className="col-span-2 row-start-2 flex min-w-0 gap-1 overflow-x-auto lg:col-span-1 lg:col-start-2 lg:row-start-1"
        >
          {ITEMS.map((item) => {
            return (
              <Button
                key={item.to}
                variant="ghost"
                asChild
                className={`press-soft h-12 shrink-0 rounded-none border-b-2 px-3 py-0 font-sans lg:h-14 ${isActive(item) ? "border-accent text-accent-ink font-semibold" : "border-transparent text-text-secondary"}`}
              >
                <Link to={item.to as never} aria-current={isActive(item) ? "page" : undefined}>
                  <span>{item.label}</span>
                </Link>
              </Button>
            );
          })}
        </nav>
        <div className="col-start-2 row-start-1 flex items-center gap-2 lg:col-start-3">
        <ClubNotificationTray unread={counts.data?.unread ?? 0} />
        <Button
          variant="ghost"
          onClick={onSignOut}
          className="min-h-11 shrink-0 px-0 font-sans text-text-secondary"
          title="Sign out"
        >
          Sign out
        </Button>
        </div>
      </div>
    </header>
  );
}
