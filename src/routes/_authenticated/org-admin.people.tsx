import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { getOrgAdminContext, listOrgRoster, type RosterCoach } from "@/lib/org-admin.functions";
import { listPolicyMatrix } from "@/lib/trust-center.functions";
import { coachPolicies } from "@/lib/club-people";
import { sportDisplayLabel } from "@/lib/coach-sports";
import { useIsMobile } from "@/hooks/use-mobile";
import { ClubPageHeader } from "@/components/org-admin/club-page-header";
import { Button } from "@/components/ui/button";
import { FilterPill } from "@/components/ui/filter-pill";

import { ClubGridToolbar } from "@/components/org-admin/club-grid-toolbar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ClubSection } from "@/components/org-admin/club-section";
import { ClubPersonCell } from "@/components/org-admin/club-person-cell";
import { ClubKeyValueTable } from "@/components/org-admin/club-key-value-table";
import { ClubNumber } from "@/components/org-admin/club-number";
import type { ClubAdmin, ClubSeatRequest } from "@/lib/club-contract.functions";
import {
  assignWaitingCoach,
  getClubContract,
  listClubSeatRequests,
  releaseClubCoach,
  removeClubAdmin,
  setClubAdminRole,
  expandClubContract,
} from "@/lib/club-contract.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { proratedSeatCost, clubUserType } from "@/lib/club-contract-quote";
import { clubSeatStatus, canRemoveClubAdmin } from "@/lib/club-seat-rules";

import { ClubDataGrid, useClubGrid, type ClubColumn } from "@/components/org-admin/club-data-grid";
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
      { title: "Users · Gradus Club Admin" },
      { name: "description", content: "Club coaches, teaching levels and policy sign-offs." },
      { property: "og:title", content: "Users · Gradus Club Admin" },
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
  const filtered = coaches;
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
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <ClubPageHeader title="Users" />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={exportRoster}
            disabled={!filtered.length}
          >
            Export
          </Button>
          <Button asChild size="sm" className="min-h-11">
            <Link to="/org-admin/roster">Invite a coach</Link>
          </Button>
        </div>
      </div>
      <ClubCapacity orgId={org.id} coaches={coaches} />
    </div>
  );
}

type UnifiedUser = {
  id: string;
  name: string;
  email: string | null;
  type: "Coach" | "Admin" | "Unassigned";
  coach?: RosterCoach;
  admin?: ClubAdmin;
  request?: ClubSeatRequest;
  joined: string | null;
};
const USER_COLUMNS: ClubColumn<UnifiedUser>[] = [
  {
    key: "name",
    label: "User",
    render: (u) => <ClubPersonCell name={u.name} email={u.email} />,
    sortValue: (u) => u.name,
  },
  {
    key: "type",
    label: "User type",
    render: (u) => u.type,
    sortValue: (u) => u.type,
    groupValue: (u) => u.type,
  },
  { key: "email", label: "Email", render: (u) => u.email ?? "—", sortValue: (u) => u.email },
  {
    key: "sports",
    label: "Sports",
    render: (u) =>
      u.coach
        ? [...new Set(u.coach.levels.map((l) => sportDisplayLabel(l.sport)))].join(", ") || "—"
        : "—",
  },
  {
    key: "students",
    label: "Students",
    align: "right",
    numeric: (u) => u.coach?.athleteCount ?? null,
  },
  {
    key: "joined",
    label: "Joined",
    render: (u) => displayDate(u.joined),
    sortValue: (u) => u.joined,
  },
];

function ClubCapacity({ orgId, coaches }: { orgId: string; coaches: RosterCoach[] }) {
  const read = useServerFn(getClubContract);
  const expand = useServerFn(expandClubContract);
  const [userSearch, setUserSearch] = useState("");
  const [userType, setUserType] = useState("all");
  const [expansion, setExpansion] = useState(false);
  const [extraSeats, setExtraSeats] = useState(1);
  const [expansionKey, setExpansionKey] = useState("");
  const remove = useServerFn(removeClubAdmin);
  const setRole = useServerFn(setClubAdminRole);
  const release = useServerFn(releaseClubCoach);
  const assign = useServerFn(assignWaitingCoach);
  const readRequests = useServerFn(listClubSeatRequests);
  const qc = useQueryClient();
  const [policyCoach, setPolicyCoach] = useState<RosterCoach | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [releasing, setReleasing] = useState<RosterCoach | null>(null);
  const [busy, setBusy] = useState(false);
  const mobile = useIsMobile();
  const [detail, setDetail] = useState<{
    coach?: RosterCoach;
    admin?: ClubAdmin;
    request?: ClubSeatRequest;
  } | null>(null);
  const [confirm, setConfirm] = useState<"role" | "assign" | null>(null);
  const { data } = useSuspenseQuery(
    queryOptions({
      queryKey: ["club-capacity", orgId],
      queryFn: () => read({ data: { organizationId: orgId } }),
    }),
  );
  const requests = useQuery({
    queryKey: ["club-seat-requests", orgId],
    queryFn: () => readRequests({ data: { organizationId: orgId } }),
  });
  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["club-capacity", orgId] }),
        qc.invalidateQueries({ queryKey: ["club-seat-requests", orgId] }),
        qc.invalidateQueries({ queryKey: ["org-people"] }),
      ]);
      toast.success(done);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const hasOpenSeat = data.seats.some((seat) => {
    const s = clubSeatStatus(seat);
    return s === "open" || s === "grace";
  });
  const users: UnifiedUser[] = coaches.map((coach) => {
    const admin = data.admins.find((a) => a.user_id === coach.userId);
    const seat = data.seats.find(
      (seat) => seat.coach_id === coach.coachId && clubSeatStatus(seat) === "filled",
    );
    return {
      id: coach.userId,
      name: `${coach.firstName} ${coach.lastName}`.trim(),
      email: coach.email,
      type: clubUserType(!!admin, !!seat),
      coach,
      admin,
      joined: coach.joinedAt,
    };
  });
  for (const admin of data.admins)
    if (!users.some((u) => u.id === admin.user_id))
      users.push({
        id: admin.user_id,
        name: "Club admin",
        email: null,
        type: "Admin",
        admin,
        joined: admin.created_at,
      });
  for (const request of requests.data ?? [])
    if (!users.some((u) => u.coach?.coachId === request.coach_id))
      users.push({
        id: request.id,
        name: request.coach_name ?? "Unassigned user",
        email: null,
        type: "Unassigned",
        request,
        joined: request.requested_at,
      });
  const visibleUsers = users.filter(
    (u) =>
      (userType === "all" || u.type === userType) &&
      `${u.name} ${u.email ?? ""}`.toLowerCase().includes(userSearch.trim().toLowerCase()),
  );
  const userGrid = useClubGrid<UnifiedUser>("club-users", USER_COLUMNS, visibleUsers);
  const quote =
    data.club.contract_seat_rate_cents == null ||
    !data.club.contract_starts_on ||
    !data.club.contract_ends_on
      ? null
      : proratedSeatCost(
          data.club.contract_seat_rate_cents,
          extraSeats,
          data.club.contract_starts_on,
          data.club.contract_ends_on,
          new Date().toISOString().slice(0, 10),
        );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          {data.seats.filter((s) => clubSeatStatus(s) === "filled").length} /{" "}
          {data.club.coach_seats} coach seats · {data.admins.length} admins
        </p>
        <Button
          variant="outline"
          className="h-11"
          onClick={() => {
            setExpansion(true);
            setExpansionKey(crypto.randomUUID());
          }}
        >
          Add seats
        </Button>
      </div>
      <ClubGridToolbar
        search={userSearch}
        onSearchChange={setUserSearch}
        searchLabel="Search users"
        activeFilters={(userSearch ? 1 : 0) + (userType !== "all" ? 1 : 0)}
        onClear={() => {
          setUserSearch("");
          setUserType("all");
        }}
      >
        <FilterPill
          aria-label="User type"
          value={userType}
          onValueChange={setUserType}
          options={[
            { value: "all", label: "All user types" },
            ...(["Coach", "Admin", "Unassigned"] as const).map((value) => ({
              value,
              label: value,
            })),
          ]}
        />
        {userGrid.menu}
      </ClubGridToolbar>
      <ClubDataGrid
        grid={userGrid}
        rowKey={(u) => u.id}
        rowLabel={(u) => u.name}
        onRowClick={(u) => setDetail({ coach: u.coach, admin: u.admin, request: u.request })}
        noun={{ one: "user", many: "users" }}
        empty="No users found."
        filtered={true}
        onClear={() => {
          setUserSearch("");
          setUserType("all");
        }}
      />
      <Sheet open={expansion} onOpenChange={setExpansion}>
        <SheetContent
          side={mobile ? "bottom" : "right"}
          className={mobile ? "paper-surface p-6" : "p-6"}
        >
          <SheetHeader>
            <SheetTitle>Add contract seats</SheetTitle>
            <SheetDescription>
              Additional seats take effect immediately. The remaining contract term is billed at
              your agreed rate.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <Label htmlFor="extra-seats">Additional coach seats</Label>
            <Input
              id="extra-seats"
              type="number"
              min={1}
              max={1000}
              value={extraSeats}
              onChange={(e) => setExtraSeats(Number(e.target.value))}
            />
            {quote == null ? (
              <p className="text-sm text-text-secondary">
                Gradus must set your contract rate and active term before seats can be added.
              </p>
            ) : (
              <ClubKeyValueTable
                rows={[
                  [
                    "True-up balance",
                    new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: data.club.contract_currency,
                    }).format(quote / 100),
                  ],
                  ["Term ends", displayDate(data.club.contract_ends_on)],
                  ["Seats after increase", data.club.coach_seats + extraSeats],
                ]}
              />
            )}
            <Button
              disabled={busy || quote == null}
              className="h-11"
              onClick={async () => {
                if (quote == null) return;
                const ok = await run(
                  () =>
                    expand({
                      data: {
                        organizationId: orgId,
                        seats: extraSeats,
                        expectedAmount: quote,
                        requestKey: expansionKey,
                      },
                    }),
                  "Seats added. True-up balance recorded for invoicing.",
                );
                if (ok) setExpansion(false);
              }}
            >
              Confirm seat increase
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <Sheet
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) {
            setDetail(null);
            setConfirm(null);
          }
        }}
      >
        <SheetContent
          side={mobile ? "bottom" : "right"}
          className={
            mobile
              ? "paper-surface max-h-[90dvh] overflow-y-auto p-6 font-sans"
              : "w-full overflow-y-auto p-6 font-sans sm:max-w-lg"
          }
        >
          <SheetHeader>
            <SheetTitle className="font-display text-h2 [&_span]:font-display">
              <ClubPersonCell
                name={
                  detail?.coach
                    ? `${detail.coach.firstName} ${detail.coach.lastName}`
                    : (detail?.request?.coach_name ?? "Club admin")
                }
                email={detail?.coach?.email}
              />
            </SheetTitle>
            <SheetDescription className="sr-only">Club membership details</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-5">
            <ClubKeyValueTable
              rows={
                detail?.admin
                  ? [
                      ["Role", detail.admin.club_role === "owner" ? "Owner" : "Admin"],
                      ["Role at the club", detail.admin.club_title || <ClubNumber value={null} />],
                      ["Added", displayDate(detail.admin.created_at)],
                    ]
                  : detail?.request
                    ? [
                        ["Joined", displayDate(detail.request.requested_at)],
                        ["Seat", "Waiting"],
                      ]
                    : [
                        ["Seat", "Filled"],
                        ["Students", <ClubNumber value={detail?.coach?.athleteCount} />],
                      ]
              }
            />
            {detail?.coach && (
              <Button
                variant="outline"
                className="h-11"
                onClick={() => {
                  setPolicyCoach(detail.coach ?? null);
                  setDetail(null);
                }}
              >
                Policy sign-offs
              </Button>
            )}
            {detail?.coach && (
              <Button asChild variant="outline" className="h-11">
                <Link to="/org-admin/coaches/$coachId" params={{ coachId: detail.coach.coachId }}>
                  Open coach profile
                </Link>
              </Button>
            )}
            <div className="flex flex-wrap gap-2">
              {detail?.request && (
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={busy || !hasOpenSeat}
                  title={hasOpenSeat ? undefined : "Release a seat first"}
                  onClick={() => setConfirm("assign")}
                >
                  Give seat
                </Button>
              )}
              {detail?.coach && !detail.admin && (
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => setReleasing(detail.coach ?? null)}
                >
                  Release seat
                </Button>
              )}
              {detail?.admin && (
                <>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={
                      busy ||
                      (detail.admin.club_role === "owner" &&
                        !data.admins.some(
                          (other) => other.id !== detail.admin?.id && other.club_role === "owner",
                        ))
                    }
                    onClick={() => setConfirm("role")}
                  >
                    {detail.admin.club_role === "owner" ? "Make admin" : "Make owner"}
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11 text-destructive"
                    disabled={busy || !canRemoveClubAdmin(data.admins, detail.admin.id)}
                    onClick={() => setRemoving(detail.admin?.id ?? null)}
                  >
                    Remove
                  </Button>
                </>
              )}
              <Button variant="outline" className="min-h-11" onClick={() => setDetail(null)}>
                Close
              </Button>
            </div>
            {confirm && (
              <div
                className="space-y-3 border-t border-divider pt-4"
                role="group"
                aria-label="Confirm membership change"
              >
                <p className="text-sm">
                  {confirm === "role"
                    ? "Change this person's club role?"
                    : "Give this coach an open seat?"}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={busy}
                    onClick={async () => {
                      const ok =
                        confirm === "role" && detail?.admin
                          ? await run(
                              () =>
                                setRole({
                                  data: {
                                    organizationId: orgId,
                                    adminId: detail.admin?.id ?? "",
                                    role: detail.admin?.club_role === "owner" ? "admin" : "owner",
                                  },
                                }),
                              "Role updated.",
                            )
                          : detail?.request
                            ? await run(
                                () =>
                                  assign({
                                    data: {
                                      organizationId: orgId,
                                      requestId: detail.request?.id ?? "",
                                    },
                                  }),
                                "Seat assigned.",
                              )
                            : false;
                      if (ok) {
                        setConfirm(null);
                        setDetail(null);
                      }
                    }}
                  >
                    Confirm
                  </Button>
                  <Button variant="ghost" className="min-h-11" onClick={() => setConfirm(null)}>
                    Close
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <CoachSheet coach={policyCoach} orgId={orgId} onClose={() => setPolicyCoach(null)} />
      <AlertDialog
        open={!!releasing}
        onOpenChange={(open) => {
          if (!open && !busy) setReleasing(null);
        }}
      >
        <AlertDialogContent className="z-[70]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-h3">
              Release {releasing ? `${releasing.firstName} ${releasing.lastName}` : "this coach"}'s
              seat?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They leave your club and the seat opens for someone else. Their own Gradus account,
              students and plans stay with them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Close</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (event) => {
                event.preventDefault();
                if (!releasing) return;
                const ok = await run(
                  () => release({ data: { organizationId: orgId, coachId: releasing.coachId } }),
                  "Seat released.",
                );
                if (ok) {
                  setReleasing(null);
                  setDetail(null);
                }
              }}
            >
              {busy ? "Releasing…" : "Release seat"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(null);
        }}
      >
        <AlertDialogContent className="z-[70]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-h3">
              Remove this club admin?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will no longer have access to the club panel. Their coach account and coach seat
              are unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Close</AlertDialogCancel>
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
                  setDetail(null);
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
          <SheetTitle className="pr-6 font-display text-h2 [&_span]:font-display">
            <ClubPersonCell
              name={coach ? `${coach.firstName} ${coach.lastName}` : null}
              email={coach?.email}
            />
          </SheetTitle>
          <SheetDescription className="sr-only">
            Coach details and policy sign-offs
          </SheetDescription>
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
                <dd>
                  {coach.joinedAt
                    ? new Date(coach.joinedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      })
                    : "—"}
                </dd>
              </div>
            </dl>
            <ClubSection title="Sports & levels">
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
            </ClubSection>
            <ClubSection
              title="Policy sign-offs"
              actions={
                <Button asChild variant="link" size="sm">
                  <Link to="/org-admin/policies">Policies</Link>
                </Button>
              }
            >
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
                              ? ` · Signed ${new Date(p.acknowledgedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`
                              : p.dueAt
                                ? ` · Due ${new Date(p.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`
                                : ""}
                          </p>
                        </div>
                        <StatusDot
                          status={
                            p.status === "signed"
                              ? "healthy"
                              : p.status === "overdue"
                                ? "attention"
                                : "informational"
                          }
                          label={
                            p.status === "signed"
                              ? "Signed"
                              : p.status === "overdue"
                                ? "Overdue"
                                : "Outstanding"
                          }
                        />
                      </li>
                    ))}
                  </ul>
                  {!policies.length && (
                    <p className="text-sm text-text-secondary">No policy sign-offs required.</p>
                  )}
                </>
              )}
            </ClubSection>
            <Button variant="outline" className="min-h-11" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function displayDate(value?: string | null) {
  if (!value) return <ClubNumber value={null} />;
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
