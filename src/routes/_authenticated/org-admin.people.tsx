import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ChevronRight, Download, Users } from "lucide-react";
import { getOrgAdminContext, listOrgRoster, type RosterCoach } from "@/lib/org-admin.functions";
import { listPolicyMatrix } from "@/lib/trust-center.functions";
import { coachPolicies } from "@/lib/club-people";
import { sportDisplayLabel } from "@/lib/coach-sports";
import { useIsMobile } from "@/hooks/use-mobile";
import { PageTitle } from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterPill } from "@/components/ui/filter-pill";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { SectionLabel } from "@/components/org-admin/trust-ui";
import { getClubContract, removeClubAdmin } from "@/lib/club-contract.functions";
import { clubSeatStatus, canRemoveClubAdmin } from "@/lib/club-seat-rules";
import { ClubTable } from "@/components/org-admin/club-table";
import { StatusDot } from "@/components/org-admin/status-dot";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

const peopleOptions = () =>
  queryOptions({
    queryKey: ["org-people"],
    queryFn: async () => {
      const ctx = await getOrgAdminContext();
      const org = ctx.organizations[0];
      if (!org) throw new Error("No club is available for this account.");
      const roster = await listOrgRoster({ data: { organizationId: org.id } });
      return { org, coaches: roster.coaches };
    },
  });

export const Route = createFileRoute("/_authenticated/org-admin/people")({
  head: () => ({
    meta: [
      { title: "People · Gradus Club Admin" },
      { name: "description", content: "Club coaches, teaching levels and policy sign-offs." },
      { property: "og:title", content: "People · Gradus Club Admin" },
      {
        property: "og:description",
        content: "Club coaches, teaching levels and policy sign-offs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(peopleOptions()),
  component: PeoplePage,
});

function PeoplePage() {
  const {
    data: { org, coaches },
  } = useSuspenseQuery(peopleOptions());
  const [search, setSearch] = useState("");
  const [sport, setSport] = useState("all");
  const [selected, setSelected] = useState<RosterCoach | null>(null);
  const sports = [...new Set(coaches.flatMap((c) => c.levels.map((l) => l.sport)))].sort();
  const filtered = coaches.filter(
    (c) =>
      `${c.firstName} ${c.lastName} ${c.email ?? ""}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (sport === "all" || c.levels.some((l) => l.sport === sport)),
  );
  function exportRoster() {
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Coach", "Email", "Sports", "Levels", "Athletes", "Parents", "Joined"],
      ...filtered.map((c) => [
        `${c.firstName} ${c.lastName}`,
        c.email,
        [...new Set(c.levels.map((l) => sportDisplayLabel(l.sport)))].join("; "),
        c.levels.map((l) => `${sportDisplayLabel(l.sport)}: ${l.label}`).join("; "),
        c.athleteCount,
        c.parentCount,
        c.joinedAt,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.map((r) => r.map(cell).join(",")).join("\r\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "club-coaches.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle subtitle={org.name}>People</PageTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportRoster} disabled={!filtered.length}>
            <Download className="size-4" />
            Export
          </Button>
          <Button asChild size="sm">
            <Link to="/org-admin/roster">
              <Users className="size-4" />
              Coaches & invites
            </Link>
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search coaches"
          placeholder="Search coaches"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-72"
        />
        <FilterPill
          aria-label="Sport"
          value={sport}
          onValueChange={setSport}
          className="w-auto min-w-40"
          options={[
            { value: "all", label: "All sports" },
            ...sports.map((s) => ({ value: s, label: sportDisplayLabel(s) })),
          ]}
        />
        <span className="text-sm text-text-secondary">{filtered.length} coaches</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Coach</TableHead>
            <TableHead>Sports</TableHead>
            <TableHead>Levels</TableHead>
            <TableHead>Athletes</TableHead>
            <TableHead>
              <span className="sr-only">Details</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((c) => (
            <TableRow key={c.coachId}>
              <TableCell className="min-w-48">
                <Button
                  variant="link"
                  className="h-auto p-0 text-text-primary"
                  onClick={() => setSelected(c)}
                >
                  {c.firstName} {c.lastName}
                </Button>
                <p className="text-xs text-text-secondary">{c.email ?? "No email on file"}</p>
              </TableCell>
              <TableCell className="min-w-40">
                {[...new Set(c.levels.map((l) => l.sport))].map(sportDisplayLabel).join(", ") ||
                  "Not set"}
              </TableCell>
              <TableCell>{c.levels.length}</TableCell>
              <TableCell>{c.athleteCount}</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`View ${c.firstName} ${c.lastName}`}
                  onClick={() => setSelected(c)}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {!filtered.length && (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-text-secondary">
                {coaches.length ? "No matching coaches." : "No coaches have joined this club yet."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <ClubCapacity orgId={org.id} coaches={coaches} />
      <CoachSheet coach={selected} orgId={org.id} onClose={() => setSelected(null)} />
    </div>
  );
}

function ClubCapacity({ orgId, coaches }: { orgId: string; coaches: RosterCoach[] }) {
  const read = useServerFn(getClubContract);
  const remove = useServerFn(removeClubAdmin);
  const qc = useQueryClient();
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data } = useSuspenseQuery(
    queryOptions({
      queryKey: ["club-capacity", orgId],
      queryFn: () => read({ data: { organizationId: orgId } }),
    }),
  );
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="font-display text-h3">Coach seats · {data.club.coach_seats} in contract</h2>
        <ClubTable>
          <TableHeader>
            <TableRow>
              <TableHead>Seat</TableHead>
              <TableHead>Coach</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sports</TableHead>
              <TableHead>Seat since</TableHead>
              <TableHead className="text-right">Students</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.seats.map((seat) => {
              const coach = coaches.find((person) => person.coachId === seat.coach_id);
              const status = clubSeatStatus(seat);
              return (
                <TableRow key={seat.id}>
                  <TableCell className="font-mono text-right tabular-nums">
                    {seat.seat_no}
                  </TableCell>
                  <TableCell>
                    {coach
                      ? `${coach.firstName} ${coach.lastName}`
                      : seat.coach_id
                        ? "Former coach"
                        : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusDot
                      status={
                        status === "filled"
                          ? "healthy"
                          : status === "grace"
                            ? "attention"
                            : "informational"
                      }
                      label={status}
                    />
                  </TableCell>
                  <TableCell>
                    {coach
                      ? [
                          ...new Set(coach.levels.map((level) => sportDisplayLabel(level.sport))),
                        ].join(", ")
                      : "—"}
                  </TableCell>
                  <TableCell>{seat.filled_at?.slice(0, 10) ?? "—"}</TableCell>
                  <TableCell className="font-mono text-right tabular-nums">
                    {coach?.athleteCount ?? "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </ClubTable>
      </section>
      <section className="space-y-3">
        <h2 className="font-display text-h3">Admins · {data.club.admin_seats} in contract</h2>
        <ClubTable>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Role at the club</TableHead>
              <TableHead>Added</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.admins.map((admin) => {
              const coach = coaches.find((person) => person.userId === admin.user_id);
              return (
                <TableRow key={admin.id}>
                  <TableCell>
                    {coach ? `${coach.firstName} ${coach.lastName}` : "Club administrator"}
                  </TableCell>
                  <TableCell>{admin.club_role}</TableCell>
                  <TableCell>{admin.club_title ?? "—"}</TableCell>
                  <TableCell>{admin.created_at.slice(0, 10)}</TableCell>
                  <TableCell>
                    <Button
                      variant="link"
                      className="min-h-11 text-text-primary"
                      disabled={!canRemoveClubAdmin(data.admins, admin.id)}
                      onClick={() => setRemoving(admin.id)}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </ClubTable>
      </section>
      <AlertDialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this club admin?</AlertDialogTitle>
            <AlertDialogDescription>
              They will no longer have access to the club panel. Their coach account and coach seat
              are unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (event) => {
                event.preventDefault();
                if (!removing) return;
                setBusy(true);
                try {
                  await remove({ data: { organizationId: orgId, adminId: removing } });
                  await qc.invalidateQueries({ queryKey: ["club-capacity", orgId] });
                  setRemoving(null);
                  toast.success("Club admin removed.");
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Could not remove club admin.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Removing…" : "Remove admin"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CoachSheet({
  coach,
  orgId,
  onClose,
}: {
  coach: RosterCoach | null;
  orgId: string;
  onClose: () => void;
}) {
  const mobile = useIsMobile();
  const fn = useServerFn(listPolicyMatrix);
  const q = useQuery({
    queryKey: ["policy-matrix", orgId],
    queryFn: () => fn({ data: { organizationId: orgId } }),
    enabled: !!coach,
  });
  const policies = coach && q.data ? coachPolicies(coach.coachId, q.data) : [];
  return (
    <Sheet
      open={!!coach}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className={
          mobile
            ? "paper-surface max-h-[90dvh] overflow-y-auto p-6"
            : "w-full sm:max-w-lg overflow-y-auto p-6"
        }
      >
        <SheetHeader>
          <SheetTitle className="pr-6 font-display text-h2">
            {coach?.firstName} {coach?.lastName}
          </SheetTitle>
          <SheetDescription>{coach?.email ?? "No email on file"}</SheetDescription>
        </SheetHeader>
        {coach && (
          <div className="mt-6 space-y-6">
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-text-secondary">Athletes</dt>
                <dd className="font-mono">{coach.athleteCount}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Parents</dt>
                <dd className="font-mono">{coach.parentCount}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Joined</dt>
                <dd>{coach.joinedAt ? new Date(coach.joinedAt).toLocaleDateString() : "—"}</dd>
              </div>
            </dl>
            <section>
              <SectionLabel>Sports & levels</SectionLabel>
              <ul className="divide-y divide-divider">
                {coach.levels.map((l) => (
                  <li
                    key={`${l.sport}:${l.key}`}
                    className="flex justify-between gap-4 py-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">{l.label}</p>
                      <p className="text-xs text-text-secondary">{sportDisplayLabel(l.sport)}</p>
                    </div>
                    <span className="shrink-0 font-mono text-xs text-text-secondary">
                      {l.practiceHours} h / week
                    </span>
                  </li>
                ))}
              </ul>
              {!coach.levels.length && (
                <p className="text-sm text-text-secondary">No teaching levels set.</p>
              )}
            </section>
            <section>
              <div className="flex items-center justify-between">
                <SectionLabel>Policy sign-offs</SectionLabel>
                <Button asChild variant="link" size="sm">
                  <Link to="/org-admin/policies">Policies</Link>
                </Button>
              </div>
              {q.isError ? (
                <div className="space-y-2">
                  <p className="text-sm text-destructive">Policy records are unavailable.</p>
                  <Button variant="outline" size="sm" onClick={() => q.refetch()}>
                    Try again
                  </Button>
                </div>
              ) : !q.data ? (
                <p className="text-sm text-text-secondary">Loading sign-offs…</p>
              ) : (
                <>
                  <ul className="divide-y divide-divider">
                    {policies.map((p) => (
                      <li
                        key={p.resourceId}
                        className="flex items-start justify-between gap-3 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium break-words">{p.title}</p>
                          <p className="text-xs text-text-secondary">
                            Version {p.version}
                            {p.acknowledgedAt
                              ? ` · Signed ${new Date(p.acknowledgedAt).toLocaleDateString()}`
                              : p.dueAt
                                ? ` · Due ${new Date(p.dueAt).toLocaleDateString()}`
                                : ""}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={
                            p.status === "overdue"
                              ? "shrink-0 text-destructive border-destructive/40"
                              : p.status === "signed"
                                ? "shrink-0 text-accent-ink border-accent/40"
                                : "shrink-0"
                          }
                        >
                          {p.status === "signed"
                            ? "Signed"
                            : p.status === "overdue"
                              ? "Overdue"
                              : "Outstanding"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                  {!policies.length && (
                    <p className="text-sm text-text-secondary">No policy sign-offs required.</p>
                  )}
                </>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
