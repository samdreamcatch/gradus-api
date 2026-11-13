import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { LessonCalendar, coachTone } from "@/components/org-admin/lesson-calendar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toIso } from "@/lib/club-lesson-calendar";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { Download, Upload, Pencil, Eye, Table2, CalendarDays, Send, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { clubCoachesOptions } from "@/components/org-admin/club-coaches-data";
import { ClubTable } from "@/components/org-admin/club-table";
import { StatusDot } from "@/components/org-admin/status-dot";
import { ClubPageHeader } from "@/components/org-admin/club-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilterPill } from "@/components/ui/filter-pill";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableFooter,
} from "@/components/ui/table";
import {
  CLUB_SCHEDULE_TEMPLATE,
  parseClubSchedule,
  clubScheduleErrors,
  clubScheduleCommitErrors,
  matchClubScheduleStudent,
  partitionClubSchedule,
  clubCoachHandoffs,
  inviteDestination,
  type ClubScheduleRow,
} from "@/lib/club-schedule";
import {
  IMPORT_DAYS,
  IMPORT_FREQUENCIES,
  formatTimeLabel,
  minutesToHHMM,
  hhmmToMinutes,
} from "@/lib/schedule-import";
import {
  getClubScheduleSeats,
  getClubScheduleHistory,
  getClubScheduleReview,
  saveClubScheduleReview,
  getClubLessonCalendar,
  sendClubLessonInvites,
  getClubScheduleStudents,
  commitClubScheduleReview,
} from "@/lib/club-schedule.functions";
import { ClubDataGrid, useClubGrid, type ClubColumn } from "@/components/org-admin/club-data-grid";
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
import type { ClubLesson } from "@/lib/club-lesson-calendar";
import { downloadCsv, toCsv } from "@/lib/csv";
import { sportDisplayLabel } from "@/lib/coach-sports";

export const Route = createFileRoute("/_authenticated/org-admin/schedule")({
  head: () => ({
    meta: [
      { title: "Schedule · Gradus Club" },
      {
        name: "description",
        content: "Review club lesson schedules and match seated coaches before invitations.",
      },
      { property: "og:title", content: "Schedule · Gradus Club" },
      {
        property: "og:description",
        content: "Review club lesson schedules and match seated coaches before invitations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: zodValidator(
    z.object({
      tab: fallback(z.string(), "calendar").default("calendar"),
      view: fallback(z.enum(["grid", "calendar"]), "calendar").default("calendar"),
      range: fallback(z.string(), "week").default("week"),
      date: fallback(z.string(), "").default(""),
      coach: fallback(z.string(), "all").default("all"),
      invite: fallback(z.string(), "all").default("all"),
    }),
  ),
  loader: ({ context }) => context.queryClient.ensureQueryData(clubCoachesOptions()),
  component: ClubSchedulePage,
});

function ClubSchedulePage() {
  const {
    data: { org, coaches },
  } = useSuspenseQuery(clubCoachesOptions());
  const qc = useQueryClient();
  const seatsFn = useServerFn(getClubScheduleSeats);
  const historyFn = useServerFn(getClubScheduleHistory);
  const reviewFn = useServerFn(getClubScheduleReview);
  const saveFn = useServerFn(saveClubScheduleReview);
  const calendarFn = useServerFn(getClubLessonCalendar);
  const studentsFn = useServerFn(getClubScheduleStudents);
  const commitFn = useServerFn(commitClubScheduleReview);
  const students = useQuery({
    queryKey: ["club-schedule-students", org.id],
    queryFn: () => studentsFn({ data: { organizationId: org.id } }),
    retry: false,
  });
  const [committed, setCommitted] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [startDate, setStartDate] = useState(toIso(new Date()));
  const seats = useQuery({
    queryKey: ["club-schedule-seats", org.id],
    queryFn: () => seatsFn({ data: { organizationId: org.id } }),
    retry: false,
  });
  const history = useQuery({
    queryKey: ["club-schedule-history", org.id],
    queryFn: () => historyFn({ data: { organizationId: org.id } }),
    retry: false,
  });
  const calendar = useQuery({
    queryKey: ["club-lesson-calendar", org.id],
    queryFn: () => calendarFn({ data: { organizationId: org.id } }),
    retry: false,
  });
  const [rows, setRows] = useState<ClubScheduleRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [step, setStep] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<ClubScheduleRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [lessonSearch, setLessonSearch] = useState("");
  const [selectedLesson, setSelectedLesson] = useState<ClubLesson | null>(null);
  const sp = Route.useSearch();
  const navigate = useNavigate({ from: "/org-admin/schedule" });
  const setSp = (patch: Partial<typeof sp>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  const view = sp.view === "grid" ? "grid" : "calendar";
  const range = sp.range === "month" ? "month" : "week";
  const calDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : toIso(new Date());
  const allLessons = calendar.data ?? [];
  const lessonCoaches = [
    ...new Map(allLessons.map((l) => [l.coachId, l.coachName])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const coachIds = lessonCoaches.map(([id]) => id);
  const inviteStatuses = [...new Set(allLessons.map((l) => l.invitationStatus))].sort();
  const lessons = allLessons.filter(
    (r) =>
      `${r.studentName} ${r.guardianName} ${r.coachName} ${r.contactEmail ?? ""}`
        .toLowerCase()
        .includes(lessonSearch.toLowerCase()) &&
      (sp.coach === "all" || r.coachId === sp.coach) &&
      (sp.invite === "all" || r.invitationStatus === sp.invite),
  );
  const activeFilters =
    (sp.coach !== "all" ? 1 : 0) + (sp.invite !== "all" ? 1 : 0) + (lessonSearch ? 1 : 0);
  const inviteable = [
    ...new Map(lessons.filter((l) => l.canInvite).map((l) => [l.athleteId, l])).values(),
  ];
  const sendFn = useServerFn(sendClubLessonInvites);
  const [sending, setSending] = useState(false);
  const [confirmSend, setConfirmSend] = useState<string[] | null>(null);
  async function sendInvites(ids: string[]) {
    setSending(true);
    try {
      const res = await sendFn({ data: { organizationId: org.id, athleteIds: ids } });
      await qc.invalidateQueries({ queryKey: ["club-lesson-calendar", org.id] });
      toast.success(
        `${res.sent} invite${res.sent === 1 ? "" : "s"} queued${res.skipped ? ` · ${res.skipped} skipped (already joined, paused or no email)` : ""}.`,
      );
      setConfirmSend(null);
      setSelectedLesson(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send invites.");
    } finally {
      setSending(false);
    }
  }
  const dayName = (d: number) => IMPORT_DAYS.find((x) => x.value === d)?.long ?? "";
  const lessonColumns: ClubColumn<ClubLesson>[] = [
    {
      key: "student",
      label: "Student",
      render: (r) => r.studentName,
      sortValue: (r) => r.studentName,
    },
    {
      key: "guardian",
      label: "Guardian",
      render: (r) => r.guardianName,
      sortValue: (r) => r.guardianName,
      className: "min-w-36 whitespace-normal",
    },
    {
      key: "coach",
      label: "Coach",
      render: (r) => r.coachName,
      sortValue: (r) => r.coachName,
      groupValue: (r) => r.coachName,
    },
    {
      key: "day",
      label: "Day",
      render: (r) => dayName(r.day),
      sortValue: (r) => (r.day + 6) % 7,
      groupValue: (r) => dayName(r.day),
    },
    {
      key: "time",
      label: "Time",
      render: (r) => (
        <span className="font-mono text-xs">
          {formatTimeLabel(r.start)}–{formatTimeLabel(r.end)}
        </span>
      ),
      sortValue: (r) => r.start,
      className: "whitespace-nowrap",
    },
    {
      key: "minutes",
      label: "Min",
      align: "right",
      render: (r) => r.minutes,
      sortValue: (r) => r.minutes,
      footer: (rows) => rows.reduce((n, r) => n + r.minutes, 0),
    },
    {
      key: "every",
      label: "Every",
      render: (r) => recurrence(r),
      groupValue: (r) => recurrence(r),
      className: "whitespace-normal",
    },
    {
      key: "recipient",
      label: "Invite to",
      render: (r) => r.recipient,
      groupValue: (r) => r.recipient,
    },
    {
      key: "email",
      label: "Contact email",
      render: (r) => r.contactEmail ?? <span className="text-text-tertiary">Not recorded</span>,
      sortValue: (r) => r.contactEmail,
      className: "min-w-48 break-all whitespace-normal",
    },
    {
      key: "invite",
      label: "Invitation",
      render: (r) => (
        <StatusDot
          status={
            r.invitationStatus === "Contact missing"
              ? "attention"
              : r.invitationStatus === "Connected"
                ? "healthy"
                : "informational"
          }
          label={r.invitationStatus}
        />
      ),
      sortValue: (r) => r.invitationStatus,
      groupValue: (r) => r.invitationStatus,
      className: "min-w-48",
    },
    {
      key: "invitedAt",
      label: "Invited",
      render: (r) => r.invitedAt?.slice(0, 10) ?? "—",
      sortValue: (r) => r.invitedAt,
      className: "font-mono text-xs whitespace-nowrap",
      defaultHidden: true,
    },
    {
      key: "schedule",
      label: "Schedule",
      render: (r) => r.scheduleStatus,
      groupValue: (r) => r.scheduleStatus,
      defaultHidden: true,
    },
  ];
  const lessonGrid = useClubGrid("schedule-lessons", lessonColumns, lessons);
  function recurrence(r: ClubLesson) {
    return `${IMPORT_FREQUENCIES.find((f) => f.value === r.frequency)?.label ?? r.frequency}${r.weeksOfMonth.length ? ` · Weeks ${r.weeksOfMonth.join(", ")}` : ""}`;
  }
  const fileRef = useRef<HTMLInputElement>(null);
  const seatedCoaches = coaches.filter((c) => seats.data?.some((s) => s.coach_id === c.coachId));
  const sports = [...new Set(coaches.flatMap((c) => c.levels.map((l) => l.sport)))];
  const issues = step >= 2 ? clubScheduleCommitErrors(rows) : clubScheduleErrors(rows);
  const decisions = rows.filter((r) => (issues[r.id]?.length ?? 0) > 0).length;
  const partition = partitionClubSchedule(rows);
  const handoffs = clubCoachHandoffs(rows);
  const groups = [...new Set(rows.map((r) => r.coachName))];
  const shown = rows.filter(
    (r) =>
      `${r.firstName} ${r.lastName} ${r.coachName} ${r.guardianEmail} ${r.athleteEmail}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter !== "attention" || !!issues[r.id]?.length),
  );
  const coachOptions = [
    { value: "none", label: "Match a seated coach" },
    ...seatedCoaches.map((c) => ({
      value: c.coachId,
      label: `${c.firstName} ${c.lastName} · Seat ${seats.data?.find((s) => s.coach_id === c.coachId)?.seat_no}`,
    })),
  ];

  async function upload(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Choose a CSV smaller than 2 MB.");
      return;
    }
    const parsed = parseClubSchedule(await file.text());
    if (parsed.error) {
      toast.error(parsed.error);
      return;
    }
    if (parsed.rows.length > 500) {
      toast.error("Import up to 500 lessons at a time.");
      return;
    }
    const next = parsed.rows.map((r) => {
      const matches = seatedCoaches.filter(
        (c) => `${c.firstName} ${c.lastName}`.trim().toLowerCase() === r.coachName.toLowerCase(),
      );
      const match = matches.length === 1 ? matches[0] : undefined;
      return {
        ...r,
        coachId: match?.coachId ?? null,
        sport: r.sport || (match?.levels.length === 1 ? (match.levels[0]?.sport ?? "") : ""),
      };
    });
    setRows(next);
    setCommitted(false);
    setFileName(file.name);
    setStep(1);
    setSearch("");
  }
  async function save() {
    setBusy(true);
    try {
      await saveFn({ data: { organizationId: org.id, fileName, rows } });
      await qc.invalidateQueries({ queryKey: ["club-schedule-history", org.id] });
      toast.success("Review saved. No invitations sent.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the review.");
    } finally {
      setBusy(false);
    }
  }
  async function openReview(id: string, name: string) {
    setBusy(true);
    try {
      setRows(await reviewFn({ data: { organizationId: org.id, importId: id } }));
      setCommitted(!!history.data?.find((r) => r.id === id)?.committed_at);
      setFileName(name);
      setStep(2);
    } catch {
      toast.error("Could not open this import.");
    } finally {
      setBusy(false);
    }
  }
  function matchStudents() {
    setRows((current) =>
      current.map((r) => ({
        ...r,
        athleteId: matchClubScheduleStudent(r, students.data ?? []),
        startsOn: r.startsOn ?? startDate,
      })),
    );
    setStep(2);
  }
  async function createLessons() {
    if (!partition.ready.length) return;
    setBusy(true);
    try {
      // Save the full review first, preserving unmatched students for later roster matching.
      if (partition.waiting.length)
        await saveFn({ data: { organizationId: org.id, fileName, rows } });
      const review = await saveFn({
        data: { organizationId: org.id, fileName, rows: partition.ready },
      });
      const result = await commitFn({ data: { organizationId: org.id, importId: review.id } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["club-schedule-history", org.id] }),
        qc.invalidateQueries({ queryKey: ["club-lesson-calendar", org.id] }),
      ]);
      if (partition.waiting.length) {
        setRows(partition.waiting);
        setCommitted(false);
        setStep(2);
      } else {
        setCommitted(true);
        setStep(3);
      }
      toast.success(
        `${result.added} lessons added · ${result.skipped} already scheduled. No emails sent.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create lessons.");
    } finally {
      setBusy(false);
    }
  }
  const exportReview = () =>
    downloadCsv(
      "club-schedule-review.csv",
      toCsv(
        ["Coach", "Athlete", "Age", "Day", "Start", "Minutes", "Frequency", "Invite destination"],
        shown.map((r) => [
          r.coachName,
          `${r.firstName} ${r.lastName}`,
          r.age,
          IMPORT_DAYS.find((d) => d.value === r.dayOfWeek)?.long,
          r.startMinute === null ? null : formatTimeLabel(r.startMinute),
          r.lengthMinutes,
          r.frequency,
          inviteDestination(r),
        ]),
      ),
    );

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5 px-4 py-6 md:px-6 md:py-8 [&_button]:min-h-11">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ClubPageHeader title="Schedule" />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/org-admin/people" search={{ tab: "students", add: true }}>
              <UserPlus className="size-4" />
              Add students
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => downloadCsv("gradus-club-schedule-template.csv", CLUB_SCHEDULE_TEMPLATE)}
          >
            <Download className="size-4" />
            CSV template
          </Button>
          <Button onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" />
            Import CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            className="hidden"
            aria-label="Upload club schedule CSV"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <Tabs
        value={sp.tab === "calendar" ? "calendar" : "imports"}
        onValueChange={(v) => setSp({ tab: v })}
        className="min-w-0"
      >
        <TabsList className="h-auto">
          <TabsTrigger value="imports" className="min-h-11 press-soft">
            Imports
          </TabsTrigger>
          <TabsTrigger value="calendar" className="min-h-11 press-soft">
            Lessons
          </TabsTrigger>
        </TabsList>
        <TabsContent value="imports" className="space-y-6">
          {seats.isError && (
            <p role="status" className="text-sm text-text-secondary">
              Could not load seated coaches. Retry by refreshing this page.
            </p>
          )}
          <ol
            aria-label="Import progress"
            className="grid grid-cols-2 gap-2 border-y border-divider py-3 sm:grid-cols-4"
          >
            {["Upload", "Match coaches", "Match students", "Lessons & invites"].map((label, i) => (
              <li
                key={label}
                aria-current={step === i ? "step" : undefined}
                className={step === i ? "font-semibold text-text-primary" : "text-text-secondary"}
              >
                <span className="mr-2 font-mono text-xs">{i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          {!!rows.length && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-h3 break-all">{fileName}</h2>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={exportReview}>
                    <Download className="size-4" />
                    Export CSV
                  </Button>
                  <Button variant="outline" onClick={save} disabled={busy}>
                    {busy ? "Saving…" : "Save review"}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 border-y border-divider py-4 sm:grid-cols-4">
                {[
                  ["Lessons", rows.length],
                  ["Coaches", groups.length],
                  ["Parent invites", rows.filter((r) => inviteDestination(r) === "parent").length],
                  ["Need a decision", decisions],
                ].map(([label, n]) => (
                  <div key={label}>
                    <p className="text-xs text-text-secondary">{label}</p>
                    <p className="font-mono text-2xl tabular-nums">{n}</p>
                  </div>
                ))}
              </div>
              {step === 1 && (
                <section className="space-y-3">
                  <h2 className="font-display text-h3">Match coaches</h2>
                  <ClubTable>
                    <TableHeader>
                      <TableRow>
                        {["Name as written", "Matched to", "Lessons", "Action"].map((h) => (
                          <TableHead key={h}>{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groups.map((name) => {
                        const group = rows.filter((r) => r.coachName === name);
                        return (
                          <TableRow key={name}>
                            <TableCell>{name || "Name missing"}</TableCell>
                            <TableCell className="min-w-64">
                              <FilterPill
                                aria-label={`Match coach ${name || "unnamed"}`}
                                value={group[0]?.coachId ?? "none"}
                                options={coachOptions}
                                onValueChange={(value) =>
                                  setRows((current) =>
                                    current.map((r) =>
                                      r.coachName === name
                                        ? { ...r, coachId: value === "none" ? null : value }
                                        : r,
                                    ),
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell className="font-mono text-right">{group.length}</TableCell>
                            <TableCell>
                              <Button asChild variant="ghost">
                                <Link to="/org-admin/people" search={{ tab: "coaches", invite: true }}>Invite a coach</Link>
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </ClubTable>
                  <div className="space-y-1">
                    <Label htmlFor="import-start-date">Lessons start on</Label>
                    <Input
                      id="import-start-date"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="max-w-56"
                    />
                  </div>
                  <Button
                    disabled={rows.some((r) => !r.coachId) || !students.data || !startDate}
                    onClick={matchStudents}
                  >
                    Match students
                  </Button>
                </section>
              )}
              {step >= 2 && (
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Input
                      aria-label="Search schedule rows"
                      placeholder="Search names or emails"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="sm:w-72"
                    />
                    <Button
                      variant={filter === "all" ? "secondary" : "outline"}
                      onClick={() => setFilter("all")}
                    >
                      All · {rows.length}
                    </Button>
                    <Button
                      variant={filter === "attention" ? "secondary" : "outline"}
                      onClick={() => setFilter("attention")}
                    >
                      Needs decision · {decisions}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSearch("");
                        setFilter("all");
                      }}
                    >
                      Clear
                    </Button>
                    <Button variant="ghost" onClick={() => setStep(1)}>
                      Match coaches
                    </Button>
                  </div>
                  <ClubTable>
                    <TableHeader>
                      <TableRow>
                        {[
                          "Athlete as written",
                          "Coach",
                          "Existing student",
                          "Day / start",
                          "Min",
                          "Invite goes to",
                          "Status",
                          "Edit",
                        ].map((h) => (
                          <TableHead key={h}>{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shown.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="min-w-40">
                            {r.firstName} {r.lastName}
                          </TableCell>
                          <TableCell>
                            {coaches.find((c) => c.coachId === r.coachId)?.firstName ?? r.coachName}
                          </TableCell>
                          <TableCell className="min-w-56">
                            <FilterPill
                              aria-label={`Match student ${r.firstName} ${r.lastName}`}
                              value={r.athleteId ?? "none"}
                              disabled={committed}
                              options={[
                                { value: "none", label: "Choose existing student" },
                                ...(students.data ?? [])
                                  .filter((s) => r.coachId && s.coachIds.includes(r.coachId))
                                  .map((s) => ({
                                    value: s.id,
                                    label: `${s.firstName} ${s.lastName} · ${s.id.slice(0, 6)}`,
                                  })),
                              ]}
                              onValueChange={(v) =>
                                setRows((current) =>
                                  current.map((item) =>
                                    item.id === r.id
                                      ? { ...item, athleteId: v === "none" ? null : v }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {IMPORT_DAYS.find((d) => d.value === r.dayOfWeek)?.short ?? "—"} ·{" "}
                            {r.startMinute === null ? "—" : formatTimeLabel(r.startMinute)}
                          </TableCell>
                          <TableCell className="font-mono text-right">
                            {r.lengthMinutes ?? "—"}
                          </TableCell>
                          <TableCell className="min-w-40">{inviteDestination(r)}</TableCell>
                          <TableCell className="min-w-48">
                            <StatusDot
                              status={issues[r.id]?.length ? "attention" : "informational"}
                              label={
                                committed
                                  ? "Lessons created"
                                  : (issues[r.id]?.[0] ?? "Ready to create")
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-11"
                              aria-label={`Edit ${r.firstName} ${r.lastName}`}
                              disabled={committed}
                              onClick={() => setEditing({ ...r })}
                            >
                              <Pencil className="size-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!shown.length && (
                        <TableRow>
                          <TableCell colSpan={8} className="py-8 text-center">
                            No matching lessons.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={4}>Review total · {shown.length} lessons</TableCell>
                        <TableCell className="font-mono text-right">
                          {shown.reduce((n, r) => n + (r.lengthMinutes ?? 0), 0)}
                        </TableCell>
                        <TableCell colSpan={3} />
                      </TableRow>
                    </TableFooter>
                  </ClubTable>
                  {step === 2 && !committed && (
                    <div className="flex flex-wrap items-center gap-3">
                      <Button disabled={!partition.ready.length || busy} onClick={createLessons}>
                        {busy ? "Creating…" : `Create lessons · ${partition.ready.length}`}
                      </Button>
                      {!!handoffs.length && (
                        <Button variant="outline" onClick={() => setHandoffOpen(true)}>
                          <Download className="size-4" />
                          New students · coach handoff
                        </Button>
                      )}
                      {!!partition.waiting.length && (
                        <span className="text-sm text-text-secondary">
                          {partition.waiting.length} lessons remain in review.
                        </span>
                      )}
                      <Button
                        variant="outline"
                        disabled={busy || students.isFetching}
                        onClick={async () => {
                          const updated = await students.refetch();
                          if (updated.error) {
                            toast.error("Could not refresh coach rosters.");
                            return;
                          }
                          setRows((current) =>
                            current.map((r) => ({
                              ...r,
                              athleteId:
                                r.athleteId ?? matchClubScheduleStudent(r, updated.data ?? []),
                            })),
                          );
                        }}
                      >
                        Refresh student matches
                      </Button>
                    </div>
                  )}
                  {committed && (
                    <div className="space-y-3 border-t border-divider pt-4">
                      <h2 className="font-display text-h3">
                        Lessons created · no invitations sent
                      </h2>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setLessonSearch("");
                          void setSp({ tab: "calendar", coach: "all", invite: "all" });
                        }}
                      >
                        Review lessons & invites
                      </Button>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
          <section className="space-y-3">
            <h2 className="font-display text-h3">Past imports</h2>
            {history.isError ? (
              <p className="text-sm text-text-secondary">Could not load import history.</p>
            ) : (
              <ClubTable>
                <TableHeader>
                  <TableRow>
                    {["Imported", "File", "Status", "Open"].map((h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.data?.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell>{new Date(record.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>{record.file_name}</TableCell>
                      <TableCell>
                        <StatusDot
                          status="informational"
                          label={
                            record.committed_at
                              ? "Lessons created"
                              : record.status === "ready"
                                ? "Review ready · not sent"
                                : "In review"
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => openReview(record.id, record.file_name)}
                        >
                          Open
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!history.data?.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-text-secondary">
                        No saved imports.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </ClubTable>
            )}
          </section>
        </TabsContent>
        <TabsContent value="calendar" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-h3">
              Recurring lessons{" "}
              <span className="font-mono text-sm text-text-secondary tabular-nums">
                {lessons.length}
                {lessons.length !== allLessons.length ? ` of ${allLessons.length}` : ""} records
              </span>
            </h2>
            <Button
              variant="outline"
              disabled={!lessons.length}
              onClick={() =>
                downloadCsv(
                  "club-lesson-calendar.csv",
                  toCsv(
                    [
                      "Student",
                      "Guardian",
                      "Coach",
                      "Day",
                      "Start",
                      "End",
                      "Minutes",
                      "Frequency",
                      "Starts on",
                      "Weeks of month",
                      "Invite recipient",
                      "Contact email",
                      "Schedule status",
                      "Invitation status",
                      "Invite recorded at",
                    ],
                    lessons.map((r) => [
                      r.studentName,
                      r.guardianName,
                      r.coachName,
                      IMPORT_DAYS.find((d) => d.value === r.day)?.long,
                      formatTimeLabel(r.start),
                      formatTimeLabel(r.end),
                      r.minutes,
                      r.frequency,
                      r.startsOn,
                      r.weeksOfMonth.join(", "),
                      r.recipient,
                      r.contactEmail,
                      r.scheduleStatus,
                      r.invitationStatus,
                      r.invitedAt,
                    ]),
                  ),
                )
              }
            >
              <Download className="size-4" />
              Export CSV
            </Button>
          </div>
          {inviteable.length ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-divider bg-card px-4 py-3">
              <p className="text-sm text-text-primary">
                {inviteable.length}{" "}
                {inviteable.length === 1 ? "student hasn't" : "students haven't"} been invited yet.
              </p>
              <div className="flex gap-2">
                <Button asChild variant="outline">
                  <Link to="/org-admin/people" search={{ tab: "students" }}>
                    Review
                  </Link>
                </Button>
                <Button
                  disabled={sending}
                  onClick={() => setConfirmSend(inviteable.map((l) => l.athleteId))}
                >
                  <Send className="size-4" />
                  Send {inviteable.length}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-divider bg-elevated px-2 py-2">
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(v) => (v === "calendar" || v === "grid") && setSp({ view: v })}
              aria-label="Lesson view"
            >
              <ToggleGroupItem value="calendar" className="press-soft gap-1.5 px-3">
                <CalendarDays className="size-4" />
                Calendar
              </ToggleGroupItem>
              <ToggleGroupItem value="grid" className="press-soft gap-1.5 px-3">
                <Table2 className="size-4" />
                Grid
              </ToggleGroupItem>
            </ToggleGroup>
            <span className="mx-1 h-6 w-px bg-divider" aria-hidden />
            <Input
              aria-label="Search recurring lessons"
              placeholder="Search student, guardian, coach or email"
              value={lessonSearch}
              onChange={(e) => setLessonSearch(e.target.value)}
              className="h-9 sm:w-72"
            />
            <FilterPill
              className="w-auto min-w-40"
              aria-label="Filter by coach"
              value={sp.coach}
              onValueChange={(v) => setSp({ coach: v || "all" })}
              options={[
                { value: "all", label: "All coaches" },
                ...lessonCoaches.map(([id, name]) => ({ value: id, label: name })),
              ]}
            />
            <FilterPill
              className="w-auto min-w-44"
              aria-label="Filter by invitation status"
              value={sp.invite}
              onValueChange={(v) => setSp({ invite: v || "all" })}
              options={[
                { value: "all", label: "Any invite status" },
                ...inviteStatuses.map((v) => ({ value: v, label: v })),
              ]}
            />
            {activeFilters > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setLessonSearch("");
                  setSp({ coach: "all", invite: "all" });
                }}
              >
                Clear · {activeFilters}
              </Button>
            )}
            {view === "grid" && (
              <>
                <span className="mx-1 h-6 w-px bg-divider" aria-hidden />
                {lessonGrid.menu}
              </>
            )}
            {view === "calendar" && !!lessonCoaches.length && (
              <div className="ml-auto flex flex-wrap gap-1.5">
                {lessonCoaches.map(([id, name]) => (
                  <span
                    key={id}
                    className="rounded-sm border-l-[3px] px-1.5 py-0.5 text-[11px]"
                    style={coachTone(id, coachIds)}
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>
          {view === "calendar" && !calendar.isError && (
            <LessonCalendar
              lessons={lessons}
              coachIds={coachIds}
              mode={range}
              date={calDate}
              onModeChange={(m) => setSp({ range: m })}
              onDateChange={(d) => setSp({ date: d })}
              onOpen={setSelectedLesson}
            />
          )}
          {calendar.isError ? (
            <p role="alert">Could not load the club calendar.</p>
          ) : (
            view === "grid" && (
              <ClubDataGrid
                grid={lessonGrid}
                rowKey={(r) => r.id}
                onRowClick={setSelectedLesson}
                rowLabel={(r) => `lesson for ${r.studentName}`}
                filtered={activeFilters > 0}
                onClear={() => {
                  setLessonSearch("");
                  setSp({ coach: "all", invite: "all" });
                }}
                empty={calendar.isPending ? "Loading lessons…" : "No recurring lessons."}
              />
            )
          )}
        </TabsContent>
      </Tabs>
      <Sheet open={handoffOpen} onOpenChange={setHandoffOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New students · coach handoff</SheetTitle>
            <SheetDescription>
              Roster setup stays with each coach. No accounts or invitations are created here.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            {handoffs.map((h) => (
              <div key={h.coachId} className="border-b border-divider pb-4">
                <h3 className="font-display text-h3">
                  {coaches.find((c) => c.coachId === h.coachId)
                    ? `${coaches.find((c) => c.coachId === h.coachId)?.firstName} ${coaches.find((c) => c.coachId === h.coachId)?.lastName}`
                    : h.coachName}
                </h3>
                <p className="mb-2 text-sm text-text-secondary">{h.lessons} unmatched lessons</p>
                {h.adultLessons > 0 && (
                  <p className="mb-2 text-sm text-text-secondary">
                    {h.adultLessons} adult lessons: the coach should use the adult athlete
                    invitation flow, not the guardian-only web CSV import.
                  </p>
                )}
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadCsv(`coach-new-students-${h.coachId.slice(0, 8)}.csv`, h.csv)
                  }
                >
                  <Download className="size-4" />
                  Download coach CSV
                </Button>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
      <Sheet
        open={!!selectedLesson}
        onOpenChange={(open) => {
          if (!open) setSelectedLesson(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Lesson details</SheetTitle>
            <SheetDescription>{selectedLesson?.studentName}</SheetDescription>
          </SheetHeader>
          {selectedLesson && (
            <dl className="mt-6 space-y-4">
              {[
                ["Student", selectedLesson.studentName],
                ["Guardian", selectedLesson.guardianName],
                ["Coach", selectedLesson.coachName],
                ["Day", IMPORT_DAYS.find((d) => d.value === selectedLesson.day)?.long],
                ["Start", formatTimeLabel(selectedLesson.start)],
                ["End", formatTimeLabel(selectedLesson.end)],
                ["Duration", `${selectedLesson.minutes} minutes`],
                ["Recurrence", recurrence(selectedLesson)],
                ["Starts on", selectedLesson.startsOn ?? "Not recorded"],
                ["Schedule", selectedLesson.scheduleStatus],
                ["Invite recipient", selectedLesson.recipient],
                ["Contact email", selectedLesson.contactEmail ?? "Not recorded"],
                ["Invitation", selectedLesson.invitationStatus],
                [
                  "Invite recorded at",
                  selectedLesson.invitedAt
                    ? new Date(selectedLesson.invitedAt).toLocaleString()
                    : "Not recorded",
                ],
              ].map(([label, value]) => (
                <div key={label} className="border-b border-divider pb-3">
                  <dt className="text-xs text-text-secondary">{label}</dt>
                  <dd className="break-words">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {selectedLesson?.canInvite && (
            <Button
              className="mt-6 w-full"
              disabled={sending}
              onClick={() => setConfirmSend([selectedLesson.athleteId])}
            >
              <Send className="size-4" />
              {selectedLesson.invitedAt ? "Resend invite" : "Send invite"} to{" "}
              {selectedLesson.contactEmail}
            </Button>
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog
        open={!!confirmSend}
        onOpenChange={(o) => {
          if (!o && !sending) setConfirmSend(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Send {confirmSend?.length ?? 0} family invite{confirmSend?.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Each family gets the usual Gradus invite email from their coach, with a link to join.
              Students who already joined, are paused, or have no email are skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={sending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmSend) void sendInvites(confirmSend);
              }}
            >
              {sending ? "Sending…" : "Send invites"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Sheet
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit lesson</SheetTitle>
            <SheetDescription>{fileName}</SheetDescription>
          </SheetHeader>
          {editing && (
            <div className="mt-6 space-y-4">
              {(
                [
                  ["First name", "firstName"],
                  ["Last name", "lastName"],
                  ["Parent email", "guardianEmail"],
                  ["Adult athlete email", "athleteEmail"],
                ] as const
              ).map(([label, key]) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`lesson-${key}`}>{label}</Label>
                  <Input
                    id={`lesson-${key}`}
                    type={key.includes("Email") ? "email" : "text"}
                    value={editing[key]}
                    onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                  />
                </div>
              ))}
              <div className="space-y-1">
                <Label htmlFor="lesson-age">Age</Label>
                <Input
                  id="lesson-age"
                  type="number"
                  min={0}
                  max={120}
                  value={editing.age ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      age: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </div>
              <FilterPill
                aria-label="Lesson coach"
                value={editing.coachId ?? "none"}
                options={coachOptions}
                onValueChange={(v) => setEditing({ ...editing, coachId: v === "none" ? null : v })}
              />
              <FilterPill
                aria-label="Lesson sport"
                value={editing.sport || "none"}
                options={[
                  { value: "none", label: "Choose sport" },
                  ...sports.map((s) => ({ value: s, label: sportDisplayLabel(s) })),
                ]}
                onValueChange={(v) => setEditing({ ...editing, sport: v === "none" ? "" : v })}
              />
              <FilterPill
                aria-label="Lesson day"
                value={editing.dayOfWeek === null ? "none" : String(editing.dayOfWeek)}
                options={[
                  { value: "none", label: "Choose day" },
                  ...IMPORT_DAYS.map((d) => ({ value: String(d.value), label: d.long })),
                ]}
                onValueChange={(v) =>
                  setEditing({ ...editing, dayOfWeek: v === "none" ? null : Number(v) })
                }
              />
              <div className="space-y-1">
                <Label htmlFor="lesson-start">Start</Label>
                <Input
                  id="lesson-start"
                  type="time"
                  value={editing.startMinute === null ? "" : minutesToHHMM(editing.startMinute)}
                  onChange={(e) =>
                    setEditing({ ...editing, startMinute: hhmmToMinutes(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lesson-minutes">Minutes</Label>
                <Input
                  id="lesson-minutes"
                  type="number"
                  min={1}
                  max={1440}
                  value={editing.lengthMinutes ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      lengthMinutes: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </div>
              <FilterPill
                aria-label="Lesson frequency"
                value={editing.frequency}
                options={IMPORT_FREQUENCIES.map((f) => ({ ...f }))}
                onValueChange={(v) =>
                  setEditing({ ...editing, frequency: v as ClubScheduleRow["frequency"] })
                }
              />
              <div className="space-y-1">
                <Label htmlFor="lesson-start-date">Starts on</Label>
                <Input
                  id="lesson-start-date"
                  type="date"
                  value={editing.startsOn ?? ""}
                  onChange={(e) => setEditing({ ...editing, startsOn: e.target.value })}
                />
              </div>
              {(editing.frequency === "monthly" || editing.frequency === "twice_monthly") && (
                <div className="space-y-1">
                  <Label>Weeks of month</Label>
                  <ToggleGroup
                    type="multiple"
                    value={(editing.weeksOfMonth ?? []).map(String)}
                    onValueChange={(values) =>
                      setEditing({ ...editing, weeksOfMonth: values.map(Number).sort() })
                    }
                  >
                    {[1, 2, 3, 4, 5].map((w) => (
                      <ToggleGroupItem key={w} value={String(w)} aria-label={`Week ${w}`}>
                        {w}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              )}
              <Button
                onClick={() => {
                  setRows((current) => current.map((r) => (r.id === editing.id ? editing : r)));
                  setEditing(null);
                  setStep(2);
                }}
              >
                Apply changes
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
