import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  listClubNotifications,
  markClubNotificationsRead,
} from "@/lib/club-notifications.functions";
import { StatusDot } from "./status-dot";
import { useOrgId } from "./org-shared";

/** Header inbox: open club notifications in a side sheet, linking to where each is resolved. */
export function ClubNotificationTray({ unread }: { unread: number }) {
  const { orgId } = useOrgId();
  const [open, setOpen] = useState(false);
  const listFn = useServerFn(listClubNotifications);
  const markFn = useServerFn(markClubNotificationsRead);
  const qc = useQueryClient();
  const feed = useQuery({
    queryKey: ["club-notifications", "tray", orgId],
    queryFn: () => listFn({ data: { organizationId: orgId! } }),
    enabled: open && !!orgId,
  });
  const mark = useMutation({
    mutationFn: (notificationId?: string) =>
      markFn({ data: { organizationId: orgId!, notificationId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["club-notifications"] });
      qc.invalidateQueries({ queryKey: ["club-notification-counts"] });
    },
  });
  const items = (feed.data?.items ?? []).filter((i) => i.status !== "resolved");
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="press relative min-h-11 min-w-11 text-text-secondary"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        onClick={() => setOpen(true)}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 min-w-4 rounded-pill bg-accent px-1 font-mono text-[10px] leading-4 text-accent-foreground">
            {unread}
          </span>
        )}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-4 bg-popover sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Needs attention</SheetTitle>
            <SheetDescription>Open items for your club, linked to where they're handled.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-2 overflow-y-auto px-4">
            {feed.isLoading && <p className="text-text-secondary">Loading…</p>}
            {feed.isError && <p role="alert" className="text-text-secondary">Notifications could not be loaded.</p>}
            {feed.isSuccess && items.length === 0 && (
              <p className="text-text-secondary">Nothing needs attention right now.</p>
            )}
            {items.map((i) => (
              <Link
                key={i.id}
                to={i.goTo as never}
                onClick={() => {
                  if (i.unread) mark.mutate(i.id);
                  setOpen(false);
                }}
                className="press block rounded-md border border-divider bg-card p-3"
              >
                <span className="flex items-center gap-2 font-semibold text-text-primary">
                  {i.unread && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                  {i.title}
                </span>
                <span className="mt-1 block text-sm text-text-secondary">{i.subject}</span>
                <span className="mt-2 block">
                  <StatusDot
                    status={i.status === "in_review" ? "critical" : "attention"}
                    label={i.status === "in_review" ? "In review" : "Needs action"}
                  />
                </span>
              </Link>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-divider p-4">
            <Button variant="ghost" disabled={!unread || mark.isPending} onClick={() => mark.mutate(undefined)}>
              Mark all read
            </Button>
            <Button variant="outline" asChild>
              <Link to="/org-admin/notifications" onClick={() => setOpen(false)}>
                View full history
              </Link>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
