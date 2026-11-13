import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  getOrgAdminContext,
  listOrgRoster,
  removeCoachFromOrg,
  listOrgCoachInvites,
  createOrgCoachInvite,
  revokeOrgCoachInvite,
  resendOrgCoachInvite,
} from "@/lib/org-admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClubPageHeader } from "@/components/org-admin/club-page-header";
import { ClubSection } from "@/components/org-admin/club-section";
import { ClubPersonCell } from "@/components/org-admin/club-person-cell";
import { ClubNumber } from "@/components/org-admin/club-number";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ClubGridToolbar } from "@/components/org-admin/club-grid-toolbar";
import { ClubDataGrid, useClubGrid, type ClubColumn } from "@/components/org-admin/club-data-grid";
import { StatusDot } from "@/components/org-admin/status-dot";
import { useIsMobile } from "@/hooks/use-mobile";

export const Route = createFileRoute("/_authenticated/org-admin/roster")({
  head: () => ({
    meta: [
      { title: "Roster · Gradus Club" },
      { name: "description", content: "Club coach roster and invitation management." },
      { property: "og:title", content: "Roster · Gradus Club" },
      { property: "og:description", content: "Club coach roster and invitation management." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrgRosterPage,
});

function OrgRosterPage() {
  const ctxFn = useServerFn(getOrgAdminContext);
  const rosterFn = useServerFn(listOrgRoster);
  const invitesFn = useServerFn(listOrgCoachInvites);
  const createInviteFn = useServerFn(createOrgCoachInvite);
  const revokeInviteFn = useServerFn(revokeOrgCoachInvite);
  const resendInviteFn = useServerFn(resendOrgCoachInvite);
  const removeFn = useServerFn(removeCoachFromOrg);
  const qc = useQueryClient();

  const ctxQ = useQuery({ queryKey: ["org-admin-ctx"], queryFn: () => ctxFn() });
  const orgId = ctxQ.data?.organizations[0]?.id;
  const orgName = ctxQ.data?.organizations[0]?.name ?? "";

  function requireOrgId() {
    if (!orgId) throw new Error("No club is available.");
    return orgId;
  }
  const rosterQ = useQuery({
    queryKey: ["org-roster", orgId],
    queryFn: () => rosterFn({ data: { organizationId: requireOrgId() } }),
    enabled: !!orgId,
  });
  const invitesQ = useQuery({
    queryKey: ["org-invites", orgId],
    queryFn: () => invitesFn({ data: { organizationId: requireOrgId() } }),
    enabled: !!orgId,
  });

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [inviting, setInviting] = useState(false);
  const [selectedCoach, setSelectedCoach] = useState<Coach | null>(null);
  const [selectedInvite, setSelectedInvite] = useState<Invite | null>(null);
  const [revoking, setRevoking] = useState<Invite | null>(null);
  const [removing, setRemoving] = useState<Coach | null>(null);
  const [search, setSearch] = useState("");
  const mobile = useIsMobile();
  const q = search.trim().toLowerCase();
  const coaches = (rosterQ.data?.coaches ?? []).filter((c) =>
    `${c.firstName} ${c.lastName} ${c.email ?? ""}`.toLowerCase().includes(q),
  );
  const invites = (invitesQ.data?.invites ?? []).filter((i) =>
    `${i.code} ${i.email ?? ""} ${i.phone ?? ""} ${i.status}`.toLowerCase().includes(q),
  );

  const createInvite = useMutation({
    mutationFn: () => createInviteFn({ data: { organizationId: requireOrgId(), email, phone } }),
    onSuccess: (res) => {
      toast.success(
        res.emailed ? `Invite emailed — code ${res.code}` : `Invite created — code ${res.code}`,
      );
      setEmail("");
      setPhone("");
      setInviting(false);
      qc.invalidateQueries({ queryKey: ["org-invites", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeInvite = useMutation({
    mutationFn: (id: string) =>
      revokeInviteFn({ data: { organizationId: requireOrgId(), inviteId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-invites", orgId] }),
  });

  const resendInvite = useMutation({
    mutationFn: (id: string) =>
      resendInviteFn({ data: { organizationId: requireOrgId(), inviteId: id } }),
    onSuccess: (res) => {
      if (res.ok) toast.success(`Invite re-sent to ${res.email}`);
      else toast.error(res.error);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeCoach = useMutation({
    mutationFn: (coachId: string) =>
      removeFn({ data: { organizationId: requireOrgId(), coachId } }),
    onSuccess: () => {
      toast.success("Coach removed from the club");
      setRemoving(null);
      setSelectedCoach(null);
      qc.invalidateQueries({ queryKey: ["org-roster", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const coachGrid = useClubGrid<Coach>("roster-coaches", coachColumns(setSelectedCoach), coaches);
  const inviteGrid = useClubGrid<Invite>(
    "roster-invites",
    inviteColumns({
      resend: (id) => resendInvite.mutate(id),
      revoke: (id) => setSelectedInvite(invites.find((invite) => invite.id === id) ?? null),
      busy: resendInvite.isPending || revokeInvite.isPending,
    }),
    invites,
  );

  if (!orgId)
    return (
      <div className="px-4 py-6 md:px-6 md:py-8">
        <ClubPageHeader title="Roster" />
        <p className="mt-5 text-text-secondary">Loading…</p>
      </div>
    );

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5 px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ClubPageHeader title="Roster" />
        <Button onClick={() => setInviting(true)} className="press">
          Invite a coach
        </Button>
      </div>
      <ClubGridToolbar
        search={search}
        onSearchChange={setSearch}
        searchLabel="Search coaches and invites"
        activeFilters={search ? 1 : 0}
        onClear={() => setSearch("")}
      >
        <span className="mx-1 h-6 w-px bg-divider" aria-hidden />
        {coachGrid.menu}
      </ClubGridToolbar>
      <ClubSection title="Coaches">
        <ClubDataGrid
          grid={coachGrid}
          onRowClick={setSelectedCoach}
          rowLabel={(c) => `${c.firstName} ${c.lastName}`.trim() || c.email || "Coach"}
          noun={{ one: "coach", many: "coaches" }}
          rowKey={(c) => c.coachId}
          filtered={!!search}
          onClear={() => setSearch("")}
          empty={rosterQ.isPending ? "Loading coaches…" : "No coaches yet."}
          showFooter
        />
      </ClubSection>
      <ClubSection title="Coach invites" actions={inviteGrid.menu}>
        <ClubDataGrid
          grid={inviteGrid}
          noun={{ one: "invite", many: "invites" }}
          showFooter
          rowKey={(i) => i.id}
          filtered={!!search}
          onClear={() => setSearch("")}
          empty="No invites yet."
        />
      </ClubSection>

      <Sheet open={inviting} onOpenChange={setInviting}>
        <SheetContent
          side={mobile ? "bottom" : "right"}
          className={
            mobile
              ? "paper-surface max-h-[90dvh] overflow-y-auto p-6"
              : "w-full overflow-y-auto p-6 sm:max-w-md"
          }
        >
          <SheetHeader>
            <SheetTitle className="font-display text-h2 [&_span]:font-display">
              Invite a coach
            </SheetTitle>
            <SheetDescription className="sr-only">
              Create a coach invitation with an 8-character code.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="space-y-1">
              <Label htmlFor="inv-email">Email</Label>
              <Input
                className="min-h-11"
                id="inv-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="coach@example.com"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-phone">Phone (optional)</Label>
              <Input
                className="min-h-11"
                id="inv-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 555 5555"
              />
            </div>
            <Button
              variant="outline"
              className="min-h-11 w-full"
              onClick={() => setInviting(false)}
            >
              Close
            </Button>
            <Button
              className="min-h-11 w-full press"
              onClick={() => createInvite.mutate()}
              disabled={createInvite.isPending || (!email && !phone)}
            >
              {createInvite.isPending ? "Creating…" : "Create invite"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={!!selectedCoach}
        onOpenChange={(open) => {
          if (!open) setSelectedCoach(null);
        }}
      >
        <SheetContent
          side={mobile ? "bottom" : "right"}
          className={
            mobile
              ? "paper-surface max-h-[90dvh] overflow-y-auto p-6 font-sans"
              : "w-full overflow-y-auto p-6 font-sans sm:max-w-md"
          }
        >
          <SheetHeader>
            <SheetTitle className="font-display text-h2 [&_span]:font-display">
              <ClubPersonCell
                name={selectedCoach ? `${selectedCoach.firstName} ${selectedCoach.lastName}` : null}
                email={selectedCoach?.email}
              />
            </SheetTitle>
            <SheetDescription className="sr-only">Coach membership actions</SheetDescription>
          </SheetHeader>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="min-h-11 text-destructive"
              onClick={() => {
                if (selectedCoach) setRemoving(selectedCoach);
              }}
            >
              Remove
            </Button>
            <Button variant="outline" className="min-h-11" onClick={() => setSelectedCoach(null)}>
              Close
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <Sheet
        open={!!selectedInvite}
        onOpenChange={(open) => {
          if (!open) setSelectedInvite(null);
        }}
      >
        <SheetContent
          side={mobile ? "bottom" : "right"}
          className={
            mobile
              ? "paper-surface max-h-[90dvh] overflow-y-auto p-6 font-sans"
              : "w-full overflow-y-auto p-6 font-sans sm:max-w-md"
          }
        >
          <SheetHeader>
            <SheetTitle className="font-display text-h2 [&_span]:font-display">
              Coach invite
            </SheetTitle>
            <SheetDescription className="sr-only">Invitation actions</SheetDescription>
          </SheetHeader>
          <p className="mt-6 font-mono tabular-nums">{selectedInvite?.code}</p>
          <div className="mt-5 flex gap-2">
            <Button
              variant="outline"
              className="min-h-11 text-destructive"
              onClick={() => setRevoking(selectedInvite)}
            >
              Revoke
            </Button>
            <Button variant="outline" className="min-h-11" onClick={() => setSelectedInvite(null)}>
              Close
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <AlertDialog
        open={!!revoking}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
      >
        <AlertDialogContent className="z-[70]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-h3">
              Revoke this invite?
            </AlertDialogTitle>
            <AlertDialogDescription>The code will no longer be usable.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction
              disabled={revokeInvite.isPending}
              onClick={async (event) => {
                event.preventDefault();
                if (!revoking) return;
                await revokeInvite.mutateAsync(revoking.id);
                setRevoking(null);
                setSelectedInvite(null);
              }}
            >
              Revoke invite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!removing}
        onOpenChange={(o) => {
          if (!o && !removeCoach.isPending) setRemoving(null);
        }}
      >
        <AlertDialogContent className="z-[70]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-h3">
              Remove {removing?.firstName} {removing?.lastName} from {orgName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Their seat opens up for someone new. Their own Gradus account stays as it is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeCoach.isPending}>Close</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeCoach.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (removing) removeCoach.mutate(removing.coachId);
              }}
            >
              {removeCoach.isPending ? "Removing…" : "Remove coach"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type Coach = Awaited<ReturnType<typeof listOrgRoster>>["coaches"][number];
type Invite = Awaited<ReturnType<typeof listOrgCoachInvites>>["invites"][number];

const sum = (rows: Coach[], k: "athleteCount" | "parentCount" | "adultAthleteCount") =>
  rows.reduce((n, r) => n + (r[k] ?? 0), 0);

function coachColumns(onRemove: (c: Coach) => void): ClubColumn<Coach>[] {
  return [
    {
      key: "name",
      label: "Coach",
      render: (c) => <ClubPersonCell name={`${c.firstName} ${c.lastName}`} email={c.email} />,
      sortValue: (c) => `${c.firstName} ${c.lastName}`,
    },
    {
      key: "email",
      label: "Email",
      render: (c) => c.email || <ClubNumber value={null} />,
      sortValue: (c) => c.email,
      className: "min-w-48 text-text-secondary",
    },
    {
      key: "athletes",
      label: "Athletes",
      align: "right",
      numeric: (c) => c.athleteCount,
      sortValue: (c) => c.athleteCount,
      footer: (r) => sum(r, "athleteCount"),
    },
    {
      key: "parents",
      label: "Parents",
      align: "right",
      numeric: (c) => c.parentCount,
      sortValue: (c) => c.parentCount,
      footer: (r) => sum(r, "parentCount"),
    },
    {
      key: "adults",
      label: "Adult athletes",
      align: "right",
      numeric: (c) => c.adultAthleteCount,
      sortValue: (c) => c.adultAthleteCount,
      footer: (r) => sum(r, "adultAthleteCount"),
    },
    {
      key: "action",
      label: "Action",
      render: (c) => (
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 text-text-primary"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(c);
          }}
        >
          View
        </Button>
      ),
    },
  ];
}

function inviteColumns(a: {
  resend: (id: string) => void;
  revoke: (id: string) => void;
  busy: boolean;
}): ClubColumn<Invite>[] {
  return [
    {
      key: "code",
      label: "Code",
      render: (i) => <span className="font-mono">{i.code}</span>,
      sortValue: (i) => i.code,
    },
    {
      key: "contact",
      label: "Sent to",
      render: (i) => i.email ?? i.phone ?? "—",
      sortValue: (i) => i.email ?? i.phone,
    },
    {
      key: "status",
      label: "Status",
      render: (i) => (
        <StatusDot
          status={
            i.status === "pending"
              ? "informational"
              : i.status === "accepted"
                ? "healthy"
                : "attention"
          }
          label={i.status}
        />
      ),
      sortValue: (i) => i.status,
      groupValue: (i) => i.status,
    },
    {
      key: "actions",
      label: "Actions",
      render: (i) =>
        i.status === "pending" ? (
          <span className="flex gap-1">
            {i.email && (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 text-text-primary"
                disabled={a.busy}
                onClick={() => a.resend(i.id)}
              >
                Resend
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 text-text-primary"
              disabled={a.busy}
              onClick={() => a.revoke(i.id)}
            >
              View
            </Button>
          </span>
        ) : null,
    },
  ];
}
