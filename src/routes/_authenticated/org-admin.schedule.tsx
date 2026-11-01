import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { Download, Upload, Pencil } from "lucide-react";
import { toast } from "sonner";
import { clubCoachesOptions } from "@/components/org-admin/club-coaches-data";
import { ClubTable } from "@/components/org-admin/club-table";
import { StatusDot } from "@/components/org-admin/status-dot";
import { PageTitle } from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilterPill } from "@/components/ui/filter-pill";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { TableHeader, TableBody, TableHead, TableRow, TableCell, TableFooter } from "@/components/ui/table";
import { CLUB_SCHEDULE_TEMPLATE, parseClubSchedule, clubScheduleErrors, inviteDestination, type ClubScheduleRow } from "@/lib/club-schedule";
import { IMPORT_DAYS, IMPORT_FREQUENCIES, formatTimeLabel, minutesToHHMM, hhmmToMinutes } from "@/lib/schedule-import";
import { getClubScheduleSeats, getClubScheduleHistory, getClubScheduleReview, saveClubScheduleReview, getClubLessonCalendar } from "@/lib/club-schedule.functions";
import { downloadCsv, toCsv } from "@/lib/csv";
import { sportDisplayLabel } from "@/lib/coach-sports";

export const Route = createFileRoute("/_authenticated/org-admin/schedule")({
  head: () => ({ meta: [
    { title: "Schedule · Gradus Club" }, { name: "description", content: "Review club lesson schedules and match seated coaches before invitations." },
    { property: "og:title", content: "Schedule · Gradus Club" }, { property: "og:description", content: "Review club lesson schedules and match seated coaches before invitations." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(clubCoachesOptions()),
  component: ClubSchedulePage,
});

function ClubSchedulePage() {
  const { data: { org, coaches } } = useSuspenseQuery(clubCoachesOptions());
  const qc = useQueryClient();
  const seatsFn = useServerFn(getClubScheduleSeats);
  const historyFn = useServerFn(getClubScheduleHistory);
  const reviewFn = useServerFn(getClubScheduleReview);
  const saveFn = useServerFn(saveClubScheduleReview);
  const calendarFn = useServerFn(getClubLessonCalendar);
  const seats = useQuery({ queryKey: ["club-schedule-seats", org.id], queryFn: () => seatsFn({ data: { organizationId: org.id } }), retry: false });
  const history = useQuery({ queryKey: ["club-schedule-history", org.id], queryFn: () => historyFn({ data: { organizationId: org.id } }), retry: false });
  const calendar = useQuery({ queryKey: ["club-lesson-calendar", org.id], queryFn: () => calendarFn({ data: { organizationId: org.id } }), retry: false });
  const [rows, setRows] = useState<ClubScheduleRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [step, setStep] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<ClubScheduleRow | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const seatedCoaches = coaches.filter((c) => seats.data?.some((s) => s.coach_id === c.coachId));
  const sports = [...new Set(coaches.flatMap((c) => c.levels.map((l) => l.sport)))];
  const issues = clubScheduleErrors(rows);
  const decisions = rows.filter((r) => (issues[r.id]?.length ?? 0) > 0).length;
  const groups = [...new Set(rows.map((r) => r.coachName))];
  const shown = rows.filter((r) => `${r.firstName} ${r.lastName} ${r.coachName} ${r.guardianEmail} ${r.athleteEmail}`.toLowerCase().includes(search.toLowerCase()) && (filter !== "attention" || !!issues[r.id]?.length));
  const coachOptions = [{ value: "none", label: "Match a seated coach" }, ...seatedCoaches.map((c) => ({ value: c.coachId, label: `${c.firstName} ${c.lastName} · Seat ${seats.data?.find((s) => s.coach_id === c.coachId)?.seat_no}` }))];

  async function upload(file: File) {
    if (file.size > 2 * 1024 * 1024) { toast.error("Choose a CSV smaller than 2 MB."); return; }
    const parsed = parseClubSchedule(await file.text());
    if (parsed.error) { toast.error(parsed.error); return; }
    if (parsed.rows.length > 500) { toast.error("Import up to 500 lessons at a time."); return; }
    const next = parsed.rows.map((r) => {
      const matches = seatedCoaches.filter((c) => `${c.firstName} ${c.lastName}`.trim().toLowerCase() === r.coachName.toLowerCase());
      const match = matches.length === 1 ? matches[0] : undefined;
      return { ...r, coachId: match?.coachId ?? null, sport: r.sport || (match?.levels.length === 1 ? match.levels[0]?.sport ?? "" : "") };
    });
    setRows(next); setFileName(file.name); setStep(1); setSearch("");
  }
  async function save() {
    setBusy(true);
    try { await saveFn({ data: { organizationId: org.id, fileName, rows } }); await qc.invalidateQueries({ queryKey: ["club-schedule-history", org.id] }); toast.success("Review saved. No invitations sent."); }
    catch { toast.error("Could not save the review. Accept the draft to enable import history."); }
    finally { setBusy(false); }
  }
  async function openReview(id: string, name: string) {
    setBusy(true);
    try { setRows(await reviewFn({ data: { organizationId: org.id, importId: id } })); setFileName(name); setStep(2); }
    catch { toast.error("Could not open this import."); }
    finally { setBusy(false); }
  }
  const exportReview = () => downloadCsv("club-schedule-review.csv", toCsv(["Coach", "Athlete", "Age", "Day", "Start", "Minutes", "Frequency", "Invite destination"], shown.map((r) => [r.coachName, `${r.firstName} ${r.lastName}`, r.age, IMPORT_DAYS.find((d) => d.value === r.dayOfWeek)?.long, r.startMinute === null ? null : formatTimeLabel(r.startMinute), r.lengthMinutes, r.frequency, inviteDestination(r)])));

  return <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8 [&_button]:min-h-11">
    <div className="flex flex-wrap items-center justify-between gap-3"><PageTitle>Schedule</PageTitle><div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => downloadCsv("gradus-club-schedule-template.csv", CLUB_SCHEDULE_TEMPLATE)}><Download className="size-4" />CSV template</Button>
      <Button onClick={() => fileRef.current?.click()}><Upload className="size-4" />Import CSV</Button>
      <input ref={fileRef} type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" className="hidden" aria-label="Upload club schedule CSV" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ""; }} />
    </div></div>
    <Tabs defaultValue="imports" className="min-w-0"><TabsList className="h-auto"><TabsTrigger value="imports" className="min-h-11 press-soft">Imports</TabsTrigger><TabsTrigger value="calendar" className="min-h-11 press-soft">Calendar</TabsTrigger></TabsList>
      <TabsContent value="imports" className="space-y-6">
        {seats.isError && <p role="status" className="text-sm text-text-secondary">Seated-coach matching becomes available when this draft is accepted.</p>}
        <ol aria-label="Import progress" className="grid grid-cols-2 gap-2 border-y border-divider py-3 sm:grid-cols-4">{["Upload", "Match coaches", "Review rows", "Send invites"].map((label, i) => <li key={label} aria-current={step === i ? "step" : undefined} className={step === i ? "font-semibold text-text-primary" : "text-text-secondary"}><span className="mr-2 font-mono text-xs">{i + 1}</span>{label}</li>)}</ol>
        {!!rows.length && <>
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-h3 break-all">{fileName}</h2><div className="flex gap-2"><Button variant="outline" onClick={exportReview}><Download className="size-4" />Export CSV</Button><Button variant="outline" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save review"}</Button></div></div>
          <div className="grid grid-cols-2 gap-4 border-y border-divider py-4 sm:grid-cols-4">{[["Lessons", rows.length], ["Coaches", groups.length], ["Parent invites", rows.filter((r) => inviteDestination(r) === "parent").length], ["Need a decision", decisions]].map(([label, n]) => <div key={label}><p className="text-xs text-text-secondary">{label}</p><p className="font-mono text-2xl tabular-nums">{n}</p></div>)}</div>
          {step === 1 && <section className="space-y-3"><h2 className="font-display text-h3">Match coaches</h2><ClubTable><TableHeader><TableRow>{["Name as written", "Matched to", "Lessons", "Action"].map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{groups.map((name) => {
            const group = rows.filter((r) => r.coachName === name);
            return <TableRow key={name}><TableCell>{name || "Name missing"}</TableCell><TableCell className="min-w-64"><FilterPill aria-label={`Match coach ${name || "unnamed"}`} value={group[0]?.coachId ?? "none"} options={coachOptions} onValueChange={(value) => setRows((current) => current.map((r) => r.coachName === name ? { ...r, coachId: value === "none" ? null : value } : r))} /></TableCell><TableCell className="font-mono text-right">{group.length}</TableCell><TableCell><Button asChild variant="ghost"><Link to="/org-admin/roster">Invite a coach</Link></Button></TableCell></TableRow>;
          })}</TableBody></ClubTable><Button disabled={rows.some((r) => !r.coachId)} onClick={() => setStep(2)}>Review rows</Button></section>}
          {step >= 2 && <section className="space-y-3"><div className="flex flex-wrap items-center gap-3"><Input aria-label="Search schedule rows" placeholder="Search names or emails" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:w-72" /><Button variant={filter === "all" ? "secondary" : "outline"} onClick={() => setFilter("all")}>All · {rows.length}</Button><Button variant={filter === "attention" ? "secondary" : "outline"} onClick={() => setFilter("attention")}>Needs decision · {decisions}</Button><Button variant="ghost" onClick={() => { setSearch(""); setFilter("all"); }}>Clear</Button><Button variant="ghost" onClick={() => setStep(1)}>Match coaches</Button></div>
            <ClubTable><TableHeader><TableRow>{["Athlete as written", "Coach", "Age", "Day / start", "Min", "Invite goes to", "Status", "Edit"].map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{shown.map((r) => <TableRow key={r.id}><TableCell className="min-w-40">{r.firstName} {r.lastName}</TableCell><TableCell>{coaches.find((c) => c.coachId === r.coachId)?.firstName ?? r.coachName}</TableCell><TableCell className="font-mono text-right">{r.age ?? "—"}</TableCell><TableCell className="whitespace-nowrap">{IMPORT_DAYS.find((d) => d.value === r.dayOfWeek)?.short ?? "—"} · {r.startMinute === null ? "—" : formatTimeLabel(r.startMinute)}</TableCell><TableCell className="font-mono text-right">{r.lengthMinutes ?? "—"}</TableCell><TableCell className="min-w-40">{inviteDestination(r)}</TableCell><TableCell className="min-w-48"><StatusDot status={issues[r.id]?.length ? "attention" : "informational"} label={issues[r.id]?.[0] ?? "Ready for matching"} /></TableCell><TableCell><Button variant="ghost" size="icon" className="size-11" aria-label={`Edit ${r.firstName} ${r.lastName}`} onClick={() => setEditing({ ...r })}><Pencil className="size-4" /></Button></TableCell></TableRow>)}{!shown.length && <TableRow><TableCell colSpan={8} className="py-8 text-center">No matching lessons.</TableCell></TableRow>}</TableBody><TableFooter><TableRow><TableCell colSpan={4}>Review total · {shown.length} lessons</TableCell><TableCell className="font-mono text-right">{shown.reduce((n, r) => n + (r.lengthMinutes ?? 0), 0)}</TableCell><TableCell colSpan={3} /></TableRow></TableFooter></ClubTable>
            {step === 2 && <Button disabled={decisions > 0} onClick={() => setStep(3)}>Continue to invites</Button>}
            {step === 3 && <div className="space-y-3 border-t border-divider pt-4"><h2 className="font-display text-h3">Invitations not sent</h2><p className="text-sm text-text-secondary">Existing-athlete matching and invitation delivery are not connected yet. This review has not added lessons or sent emails.</p><Button variant="outline" onClick={() => setStep(2)}>Back to review</Button></div>}
          </section>}
        </>}
        <section className="space-y-3"><h2 className="font-display text-h3">Past imports</h2>{history.isError ? <p className="text-sm text-text-secondary">Import history becomes available when this draft is accepted.</p> : <ClubTable><TableHeader><TableRow>{["Imported", "File", "Status", "Open"].map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{history.data?.map((record) => <TableRow key={record.id}><TableCell>{new Date(record.created_at).toLocaleDateString()}</TableCell><TableCell>{record.file_name}</TableCell><TableCell><StatusDot status="informational" label={record.status === "ready" ? "Review ready · not sent" : "In review"} /></TableCell><TableCell><Button variant="ghost" disabled={busy} onClick={() => openReview(record.id, record.file_name)}>Open</Button></TableCell></TableRow>)}{!history.data?.length && <TableRow><TableCell colSpan={4} className="py-8 text-center text-text-secondary">No saved imports.</TableCell></TableRow>}</TableBody></ClubTable>}</section>
      </TabsContent>
      <TabsContent value="calendar" className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-h3">Recurring lessons</h2><Button variant="outline" disabled={!calendar.data?.length} onClick={() => downloadCsv("club-lesson-calendar.csv", toCsv(["Coach", "Day", "Frequency", "Lessons", "Minutes", "First start", "Last end"], (calendar.data ?? []).map((r) => [r.coachName, IMPORT_DAYS.find((d) => d.value === r.day)?.long, r.frequency, r.lessons, r.minutes, formatTimeLabel(r.first), formatTimeLabel(r.last)])))}><Download className="size-4" />Export CSV</Button></div>{calendar.isError ? <p role="alert">Could not load the club calendar.</p> : <ClubTable><TableHeader><TableRow>{["Coach", "Day", "Every", "Lessons", "Minutes", "First start", "Last end"].map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{calendar.data?.map((r) => <TableRow key={`${r.coachId}-${r.day}-${r.frequency}`}><TableCell>{r.coachName}</TableCell><TableCell>{IMPORT_DAYS.find((d) => d.value === r.day)?.long}</TableCell><TableCell>{IMPORT_FREQUENCIES.find((f) => f.value === r.frequency)?.label ?? r.frequency}</TableCell><TableCell className="font-mono text-right">{r.lessons}</TableCell><TableCell className="font-mono text-right">{r.minutes}</TableCell><TableCell>{formatTimeLabel(r.first)}</TableCell><TableCell>{formatTimeLabel(r.last)}</TableCell></TableRow>)}{!calendar.data?.length && <TableRow><TableCell colSpan={7} className="py-8 text-center text-text-secondary">{calendar.isPending ? "Loading lessons…" : "No recurring lessons."}</TableCell></TableRow>}</TableBody></ClubTable>}</TabsContent>
    </Tabs>
    <Sheet open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}><SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>Edit lesson</SheetTitle><SheetDescription>{fileName}</SheetDescription></SheetHeader>{editing && <div className="mt-6 space-y-4">
      {([ ["First name", "firstName"], ["Last name", "lastName"], ["Parent email", "guardianEmail"], ["Adult athlete email", "athleteEmail"] ] as const).map(([label, key]) => <div key={key} className="space-y-1"><Label htmlFor={`lesson-${key}`}>{label}</Label><Input id={`lesson-${key}`} type={key.includes("Email") ? "email" : "text"} value={editing[key]} onChange={(e) => setEditing({ ...editing, [key]: e.target.value })} /></div>)}
      <div className="space-y-1"><Label htmlFor="lesson-age">Age</Label><Input id="lesson-age" type="number" min={0} max={120} value={editing.age ?? ""} onChange={(e) => setEditing({ ...editing, age: e.target.value === "" ? null : Number(e.target.value) })} /></div>
      <FilterPill aria-label="Lesson coach" value={editing.coachId ?? "none"} options={coachOptions} onValueChange={(v) => setEditing({ ...editing, coachId: v === "none" ? null : v })} />
      <FilterPill aria-label="Lesson sport" value={editing.sport || "none"} options={[{ value: "none", label: "Choose sport" }, ...sports.map((s) => ({ value: s, label: sportDisplayLabel(s) }))]} onValueChange={(v) => setEditing({ ...editing, sport: v === "none" ? "" : v })} />
      <FilterPill aria-label="Lesson day" value={editing.dayOfWeek === null ? "none" : String(editing.dayOfWeek)} options={[{ value: "none", label: "Choose day" }, ...IMPORT_DAYS.map((d) => ({ value: String(d.value), label: d.long }))]} onValueChange={(v) => setEditing({ ...editing, dayOfWeek: v === "none" ? null : Number(v) })} />
      <div className="space-y-1"><Label htmlFor="lesson-start">Start</Label><Input id="lesson-start" type="time" value={editing.startMinute === null ? "" : minutesToHHMM(editing.startMinute)} onChange={(e) => setEditing({ ...editing, startMinute: hhmmToMinutes(e.target.value) })} /></div>
      <div className="space-y-1"><Label htmlFor="lesson-minutes">Minutes</Label><Input id="lesson-minutes" type="number" min={1} max={1440} value={editing.lengthMinutes ?? ""} onChange={(e) => setEditing({ ...editing, lengthMinutes: e.target.value === "" ? null : Number(e.target.value) })} /></div>
      <FilterPill aria-label="Lesson frequency" value={editing.frequency} options={IMPORT_FREQUENCIES.map((f) => ({ ...f }))} onValueChange={(v) => setEditing({ ...editing, frequency: v as ClubScheduleRow["frequency"] })} />
      <Button onClick={() => { setRows((current) => current.map((r) => r.id === editing.id ? editing : r)); setEditing(null); setStep(2); }}>Apply changes</Button>
    </div>}</SheetContent></Sheet>
  </div>;
}