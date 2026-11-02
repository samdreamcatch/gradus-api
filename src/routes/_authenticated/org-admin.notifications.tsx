import { createFileRoute, Link } from "@tanstack/react-router";
import { ClubGridToolbar } from "@/components/org-admin/club-grid-toolbar";
import {
  queryOptions,
  useSuspenseQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { getOrgAdminContext } from "@/lib/org-admin.functions";
import {
  listClubNotifications,
  markClubNotificationsRead,
  getClubNotificationNotes,
  addClubNotificationNote,
} from "@/lib/club-notifications.functions";
import { notificationTotals, type ClubNotification } from "@/lib/club-notifications";
import { downloadCsv, toCsv } from "@/lib/csv";
import { PageTitle } from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableFooter,
} from "@/components/ui/table";
import { ClubTable } from "@/components/org-admin/club-table";
import { ClubStatusLegend, StatusDot } from "@/components/org-admin/status-dot";

const feedOptions = () =>
  queryOptions({
    queryKey: ["club-notifications"],
    queryFn: async () => {
      const ctx = await getOrgAdminContext();
      const org = ctx.organizations[0];
      if (!org) throw new Error("No club is available for this account.");
      return { org, ...(await listClubNotifications({ data: { organizationId: org.id } })) };
    },
  });
export const Route = createFileRoute("/_authenticated/org-admin/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications · Gradus Club" },
      { name: "description", content: "Club safeguarding updates, follow-ups and evidence notes." },
      { property: "og:title", content: "Notifications · Gradus Club" },
      {
        property: "og:description",
        content: "Club safeguarding updates, follow-ups and evidence notes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(feedOptions()),
  errorComponent: () => (
    <div className="p-8 space-y-4">
      <PageTitle>Notifications</PageTitle>
      <p role="alert" className="text-text-secondary">
        Club notifications could not be loaded. New notification records become available after this
        draft is accepted.
      </p>
    </div>
  ),
  component: NotificationsPage,
});
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
function NotificationState({ item }: { item: ClubNotification }) {
  return (
    <StatusDot
      status={
        item.status === "resolved"
          ? "healthy"
          : item.status === "in_review"
            ? "critical"
            : "attention"
      }
      label={
        item.status === "resolved"
          ? "Resolved"
          : item.status === "in_review"
            ? "In review"
            : "Needs action"
      }
    />
  );
}
function NotificationsPage() {
  const {
    data: { org, items },
  } = useSuspenseQuery(feedOptions());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<ClubNotification | null>(null);
  const markFn = useServerFn(markClubNotificationsRead);
  const qc = useQueryClient();
  const mark = useMutation({
    mutationFn: (notificationId?: string) =>
      markFn({ data: { organizationId: org.id, notificationId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["club-notifications"] });
      qc.invalidateQueries({ queryKey: ["club-notification-counts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const totals = notificationTotals(items);
  const filtered = items.filter(
    (i) =>
      `${i.title} ${i.subject} ${i.coach ?? ""}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "action" && i.status !== "resolved") ||
        (filter === "unread" && i.unread) ||
        i.about === filter),
  );
  function open(item: ClubNotification) {
    setSelected(item);
    if (item.unread) mark.mutate(item.id);
  }
  function exportFeed() {
    downloadCsv(
      "club-notifications.csv",
      toCsv(
        ["When", "About", "What happened", "Who / what", "Coach", "Status", "Resolution"],
        filtered.map((i) => [
          i.openedAt,
          i.about,
          i.title,
          i.subject,
          i.coach,
          i.status,
          i.resolution,
        ]),
      ),
    );
  }
  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 md:px-8 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle>Notifications</PageTitle>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportFeed}>
            <Download className="size-4" />
            Export CSV
          </Button>
          <Button
            disabled={!totals.unread || mark.isPending}
            onClick={() => mark.mutate(undefined)}
          >
            Mark all read
          </Button>
        </div>
      </div>
      <ClubGridToolbar
        search={search}
        onSearchChange={setSearch}
        searchLabel="Search notifications"
        activeFilters={(search ? 1 : 0) + (filter !== "all" ? 1 : 0)}
        onClear={() => { setSearch(""); setFilter("all"); }}
      />
      <ClubStatusLegend />
      <section className="space-y-3">
        <h2 className="font-display text-h3">All notifications</h2>
        <div className="flex flex-wrap gap-2">
          {[
            ["action", `Needs action · ${totals.open}`],
            ["unread", `Unread · ${totals.unread}`],
            ["athletes", "Athletes"],
            ["coaches", "Coaches"],
            ["library", "Library"],
            ["all", `All · ${items.length}`],
          ].map(([value, label]) => (
            <Button
              key={value}
              variant={filter === value ? "secondary" : "outline"}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <ClubTable>
          <TableHeader>
            <TableRow>
              {[
                "When",
                "About",
                "What happened",
                "Who / what",
                "Coach",
                "Status",
                "Go to",
                "Action",
              ].map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {date(item.openedAt)}
                </TableCell>
                <TableCell className="capitalize">{item.about}</TableCell>
                <TableCell className="min-w-52">
                  <Button
                    variant="link"
                    className="min-h-11 text-left text-text-primary"
                    onClick={() => open(item)}
                  >
                    {item.unread && (
                      <span
                        className="size-1.5 rounded-full bg-text-primary shrink-0"
                        aria-label="Unread"
                      />
                    )}
                    {item.title}
                  </Button>
                  {item.resolvedAt && (
                    <p className="font-hand text-lg italic text-text-secondary">
                      Resolved {date(item.resolvedAt)}
                    </p>
                  )}
                </TableCell>
                <TableCell className="min-w-40">{item.subject}</TableCell>
                <TableCell>{item.kind === "report" ? "Withheld" : (item.coach ?? "—")}</TableCell>
                <TableCell>
                  <NotificationState item={item} />
                </TableCell>
                <TableCell>
                  {item.goTo === "/org-admin/notifications" ? (
                    <Button variant="link" onClick={() => open(item)}>
                      View status
                    </Button>
                  ) : (
                    <Button variant="link" asChild>
                      <Link to={item.goTo as "/org-admin/resources" | "/org-admin/roster"}>
                        Open
                      </Link>
                    </Button>
                  )}
                </TableCell>
                <TableCell>
                  <Button variant="outline" onClick={() => open(item)}>
                    Note
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!filtered.length && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-text-secondary">
                  {items.length ? "No matching notifications." : "No notifications."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={8}>
                {totals.open} open · Average {totals.averageDays?.toFixed(1) ?? "—"} days open ·
                Median {totals.medianDays?.toFixed(1) ?? "—"} days open
              </TableCell>
            </TableRow>
          </TableFooter>
        </ClubTable>
      </section>
      <Sheet
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
      >
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-6">
          {selected && <EvidencePanel orgId={org.id} item={selected} key={selected.id} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
function EvidencePanel({ orgId, item }: { orgId: string; item: ClubNotification }) {
  const [body, setBody] = useState("");
  const readFn = useServerFn(getClubNotificationNotes);
  const addFn = useServerFn(addClubNotificationNote);
  const qc = useQueryClient();
  const key = ["club-notification-notes", orgId, item.id];
  const notes = useQuery({
    queryKey: key,
    queryFn: () => readFn({ data: { organizationId: orgId, notificationId: item.id } }),
  });
  const add = useMutation({
    mutationFn: () => addFn({ data: { organizationId: orgId, notificationId: item.id, body } }),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: key });
      toast.success("Note added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-6">
      <SheetHeader>
        <SheetTitle>{item.title}</SheetTitle>
        <SheetDescription>{item.subject}</SheetDescription>
      </SheetHeader>
      <NotificationState item={item} />
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt>Opened</dt>
          <dd>{date(item.openedAt)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Coach</dt>
          <dd>{item.kind === "report" ? "Withheld" : (item.coach ?? "—")}</dd>
        </div>
        {item.resolution && (
          <div>
            <dt>Resolution</dt>
            <dd>{item.resolution}</dd>
          </div>
        )}
      </dl>
      <section className="space-y-3">
        <h3 className="font-display text-h3">Evidence notes</h3>
        {notes.isError ? (
          <p role="alert" className="text-destructive">
            Could not load notes.
          </p>
        ) : notes.isPending ? (
          <p>Loading notes…</p>
        ) : notes.data?.notes.length ? (
          <ol className="divide-y divide-divider">
            {notes.data.notes.map((n) => (
              <li className="py-3 space-y-1" key={n.id}>
                <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                <p className="text-xs font-mono text-text-secondary">{date(n.createdAt)}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-text-secondary">No notes yet.</p>
        )}
        <Label htmlFor="evidence-note">Add a note</Label>
        <Textarea
          id="evidence-note"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          className="min-h-32 resize-y"
        />
        <Button disabled={!body.trim() || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? "Saving…" : "Add note"}
        </Button>
      </section>
    </div>
  );
}
