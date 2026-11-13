import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Send } from "lucide-react";
import { toast } from "sonner";
import type { RosterCoach } from "@/lib/org-admin.functions";
import { getClubStudents, type ClubStudent } from "@/lib/club-students.functions";
import { getClubScheduleSeats, sendClubLessonInvites } from "@/lib/club-schedule.functions";
import type { ClubInviteStatus } from "@/lib/club-add-students";
import { Button } from "@/components/ui/button";
import { FilterPill } from "@/components/ui/filter-pill";
import { ClubGridToolbar } from "@/components/org-admin/club-grid-toolbar";
import { ClubDataGrid, useClubGrid, type ClubColumn } from "@/components/org-admin/club-data-grid";
import { ClubPersonCell } from "@/components/org-admin/club-person-cell";
import { StatusDot, type ClubStatus } from "@/components/org-admin/status-dot";
import { ClubAddStudentsSheet } from "@/components/org-admin/club-add-students-sheet";
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

const TONE: Record<ClubInviteStatus, ClubStatus> = {
  Joined: "healthy",
  Invited: "informational",
  "Not invited": "attention",
  "Missing email": "critical",
};

const COLUMNS: ClubColumn<ClubStudent>[] = [
  {
    key: "name",
    label: "Student",
    render: (s) => <ClubPersonCell name={s.name} />,
    sortValue: (s) => s.name,
  },
  {
    key: "age",
    label: "Age",
    render: (s) => (s.adult ? "Over 18" : "Under 18"),
    groupValue: (s) => (s.adult ? "Over 18" : "Under 18"),
  },
  {
    key: "guardian",
    label: "Parent or guardian",
    render: (s) => (s.adult ? "Self" : (s.guardian ?? "—")),
    sortValue: (s) => s.guardian,
  },
  { key: "email", label: "Invite email", render: (s) => s.email ?? "—", sortValue: (s) => s.email },
  {
    key: "coaches",
    label: "Coach",
    render: (s) => s.coaches.join(", ") || "—",
    sortValue: (s) => s.coaches[0] ?? "",
    groupValue: (s) => s.coaches[0] ?? "No coach",
  },
  { key: "lessons", label: "Lessons", align: "right", numeric: (s) => s.lessons },
  {
    key: "status",
    label: "Invite",
    render: (s) => <StatusDot status={TONE[s.status]} label={s.status} />,
    sortValue: (s) => s.status,
    groupValue: (s) => s.status,
  },
];

export function ClubStudentsPanel({
  orgId,
  coaches,
  startOpen,
  onOpened,
}: {
  orgId: string;
  coaches: RosterCoach[];
  startOpen?: boolean;
  onOpened?: () => void;
}) {
  const qc = useQueryClient();
  const readStudents = useServerFn(getClubStudents);
  const readSeats = useServerFn(getClubScheduleSeats);
  const invite = useServerFn(sendClubLessonInvites);
  const students = useQuery({
    queryKey: ["club-students", orgId],
    queryFn: () => readStudents({ data: { organizationId: orgId } }),
  });
  const seats = useQuery({
    queryKey: ["club-schedule-seats", orgId],
    queryFn: () => readSeats({ data: { organizationId: orgId } }),
  });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [confirmInvite, setConfirmInvite] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (startOpen) {
      setOpen(true);
      onOpened?.();
    }
  }, [startOpen, onOpened]);

  const all = students.data ?? [];
  const rows = all.filter(
    (s) =>
      (status === "all" || s.status === status) &&
      `${s.name} ${s.guardian ?? ""} ${s.email ?? ""} ${s.coaches.join(" ")}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const grid = useClubGrid<ClubStudent>("club-students", COLUMNS, rows);
  const waiting = all.filter((s) => s.status === "Not invited");

  async function sendWaiting() {
    setConfirmInvite(false);
    setBusy(true);
    try {
      const out = await invite({
        data: { organizationId: orgId, athleteIds: waiting.map((s) => s.athleteId) },
      });
      toast.success(`${out.sent} ${out.sent === 1 ? "invite" : "invites"} sent`);
      await qc.invalidateQueries({ queryKey: ["club-students", orgId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send invites.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          {all.length} {all.length === 1 ? "student" : "students"} across club coaches
        </p>
        <Button className="min-h-11 press" onClick={() => setOpen(true)} disabled={!seats.data}>
          <Plus className="size-4" /> Add students
        </Button>
      </div>
      {waiting.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-divider bg-card px-4 py-3">
          <p className="text-sm text-text-primary">
            {waiting.length} {waiting.length === 1 ? "family hasn't" : "families haven't"} been
            invited yet.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="min-h-11 press"
              onClick={() => setStatus("Not invited")}
            >
              Review
            </Button>
            <Button
              className="min-h-11 press"
              disabled={busy}
              onClick={() => setConfirmInvite(true)}
            >
              <Send className="size-4" /> Send {waiting.length}
            </Button>
          </div>
        </div>
      ) : null}
      <ClubGridToolbar
        search={search}
        onSearchChange={setSearch}
        searchLabel="Search students, parents, coaches"
        activeFilters={(search ? 1 : 0) + (status !== "all" ? 1 : 0)}
        onClear={() => {
          setSearch("");
          setStatus("all");
        }}
      >
        <FilterPill
          className="w-auto min-w-40"
          aria-label="Invite status"
          value={status}
          onValueChange={setStatus}
          options={[
            { value: "all", label: "Any invite status" },
            ...(["Not invited", "Invited", "Joined", "Missing email"] as const).map((value) => ({
              value,
              label: value,
            })),
          ]}
        />
      </ClubGridToolbar>
      <ClubDataGrid
        grid={grid}
        rowKey={(s) => s.athleteId}
        rowLabel={(s) => s.name}
        filtered={rows.length !== all.length}
        onClear={() => {
          setSearch("");
          setStatus("all");
        }}
        noun={{ one: "student", many: "students" }}
        empty={
          students.isLoading ? "Loading students…" : "No students yet — use Add students to start."
        }
      />
      {open && seats.data ? (
        <ClubAddStudentsSheet
          open={open}
          onOpenChange={setOpen}
          orgId={orgId}
          coaches={coaches}
          seatedCoachIds={seats.data.flatMap((s) => (s.coach_id ? [s.coach_id] : []))}
          students={all}
        />
      ) : null}
      <AlertDialog open={confirmInvite} onOpenChange={setConfirmInvite}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send {waiting.length} invites?</AlertDialogTitle>
            <AlertDialogDescription>
              Each family (or adult athlete) gets their invitation email now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void sendWaiting()}>Send invites</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
