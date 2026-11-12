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
import { Plus } from "lucide-react";
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
import { ClubGridToolbar, ClubGridCount } from "@/components/org-admin/club-grid-toolbar";
import { ClubDataGrid, useClubGrid, type ClubColumn } from "@/components/org-admin/club-data-grid";
import { StatusDot } from "@/components/org-admin/status-dot";
import { useIsMobile } from "@/hooks/use-mobile";

export const Route = createFileRoute("/_authenticated/org-admin/roster")({
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

  const rosterQ = useQuery({
    queryKey: ["org-roster", orgId],
    queryFn: () => rosterFn({ data: { organizationId: orgId! } }),
    enabled: !!orgId,
  });
  const invitesQ = useQuery({
    queryKey: ["org-invites", orgId],
    queryFn: () => invitesFn({ data: { organizationId: orgId! } }),
    enabled: !!orgId,
  });

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [inviting, setInviting] = useState(false);
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
    mutationFn: () => createInviteFn({ data: { organizationId: orgId!, email, phone } }),
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
    mutationFn: (id: string) => revokeInviteFn({ data: { organizationId: orgId!, inviteId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-invites", orgId] }),
  });

  const resendInvite = useMutation({
    mutationFn: (id: string) => resendInviteFn({ data: { organizationId: orgId!, inviteId: id } }),
    onSuccess: (res) => {
      if (res.ok) toast.success(`Invite re-sent to ${res.email}`);
      else toast.error(res.error);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeCoach = useMutation({
    mutationFn: (coachId: string) => removeFn({ data: { organizationId: orgId!, coachId } }),
    onSuccess: () => {
      toast.success("Coach removed from the club");
      setRemoving(null);
      qc.invalidateQueries({ queryKey: ["org-roster", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const coachGrid = useClubGrid<Coach>("roster-coaches", coachColumns(setRemoving), coaches);
  const inviteGrid = useClubGrid<Invite>(
    "roster-invites",
    inviteColumns({
      resend: (id) => resendInvite.mutate(id),
      revoke: (id) => revokeInvite.mutate(id),
      busy: resendInvite.isPending || revokeInvite.isPending,
    }),
    invites,
  );

  if (!orgId) return <div className="p-6 text-text-secondary">Loading…</div>;

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5 px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ClubPageHeader title="Roster" />
        <Button onClick={() => setInviting(true)} className="press">
          <Plus className="size-4" />
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
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-h3">Coaches</h2>
          <ClubGridCount
            shown={coaches.length}
            total={rosterQ.data?.coaches.length ?? 0}
            noun="coaches"
          />
        </div>
        <ClubDataGrid
          grid={coachGrid}
          rowKey={(c) => c.coachId}
          filtered={!!search}
          onClear={() => setSearch("")}
          empty={rosterQ.isPending ? "Loading coaches…" : "No coaches yet."}
          showFooter
        />
      </section>
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-h3">Coach invites</h2>
          <div className="flex items-center gap-2">
            {inviteGrid.menu}
            <ClubGridCount
              shown={invites.length}
              total={invitesQ.data?.invites.length ?? 0}
              noun="invites"
            />
          </div>
        </div>
        <ClubDataGrid
          grid={inviteGrid}
          rowKey={(i) => i.id}
          filtered={!!search}
          onClear={() => setSearch("")}
          empty="No invites yet."
        />
      </section>

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
            <SheetTitle className="font-display text-h2">Invite a coach</SheetTitle>
            <SheetDescription>
              They get an 8-character code to join {orgName}. Add an email to send it for you.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="space-y-1">
              <Label htmlFor="inv-email">Email</Label>
              <Input
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
                id="inv-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 555 5555"
              />
            </div>
            <Button
              className="w-full press"
              onClick={() => createInvite.mutate()}
              disabled={createInvite.isPending || (!email && !phone)}
            >
              {createInvite.isPending ? "Creating…" : "Create invite"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={!!removing}
        onOpenChange={(o) => {
          if (!o && !removeCoach.isPending) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removing?.firstName} {removing?.lastName} from {orgName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Their seat opens up for someone new. Their own Gradus account stays as it is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeCoach.isPending}>Cancel</AlertDialogCancel>
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
      render: (c) => `${c.firstName} ${c.lastName}`,
      sortValue: (c) => `${c.firstName} ${c.lastName}`,
    },
    {
      key: "email",
      label: "Email",
      render: (c) => c.email ?? <span className="text-text-tertiary">No email</span>,
      sortValue: (c) => c.email,
      className: "min-w-48 text-text-secondary",
    },
    {
      key: "athletes",
      label: "Athletes",
      align: "right",
      render: (c) => c.athleteCount,
      sortValue: (c) => c.athleteCount,
      footer: (r) => sum(r, "athleteCount"),
    },
    {
      key: "parents",
      label: "Parents",
      align: "right",
      render: (c) => c.parentCount,
      sortValue: (c) => c.parentCount,
      footer: (r) => sum(r, "parentCount"),
    },
    {
      key: "adults",
      label: "Adult athletes",
      align: "right",
      render: (c) => c.adultAthleteCount,
      sortValue: (c) => c.adultAthleteCount,
      footer: (r) => sum(r, "adultAthleteCount"),
    },
    {
      key: "action",
      label: "Action",
      render: (c) => (
        <Button
          variant="link"
          size="sm"
          className="text-text-primary"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(c);
          }}
        >
          Remove
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
                variant="link"
                size="sm"
                className="text-text-primary"
                disabled={a.busy}
                onClick={() => a.resend(i.id)}
              >
                Resend
              </Button>
            )}
            <Button
              variant="link"
              size="sm"
              className="text-text-primary"
              disabled={a.busy}
              onClick={() => a.revoke(i.id)}
            >
              Revoke
            </Button>
          </span>
        ) : null,
    },
  ];
}
