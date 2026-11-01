import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { clubCoachesOptions } from "@/components/org-admin/club-coaches-data";
import { getClubCoachWeeks } from "@/lib/club-coaches.functions";
import { weekStart, targetPercent, sumCoachWeeks } from "@/lib/club-coach-metrics";
import { sportDisplayLabel } from "@/lib/coach-sports";
import { downloadCsv, toCsv } from "@/lib/csv";
import { PageTitle } from "@/components/page-title";
import { ClubTable } from "@/components/org-admin/club-table";
import { TableHeader, TableBody, TableHead, TableRow, TableCell, TableFooter } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterPill } from "@/components/ui/filter-pill";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/org-admin/coaches/")({
  head: () => ({ meta: [
    { title: "Coaches · Gradus Club" },
    { name: "description", content: "Club coach directory and private weekly practice totals." },
    { property: "og:title", content: "Coaches · Gradus Club" },
    { property: "og:description", content: "Club coach directory and private weekly practice totals." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(clubCoachesOptions()),
  component: CoachesPage,
});

type SavedView = { name: string; search: string; sport: string; sort: string };

function CoachesPage() {
  const { data: { org, coaches, viewerId } } = useSuspenseQuery(clubCoachesOptions());
  const read = useServerFn(getClubCoachWeeks);
  const metrics = useQuery({ queryKey: ["club-coach-weeks", org.id], queryFn: () => read({ data: { organizationId: org.id } }), retry: false });
  const [period, setPeriod] = useState(weekStart());
  const [search, setSearch] = useState("");
  const [sport, setSport] = useState("all");
  const [sort, setSort] = useState("name");
  const [views, setViews] = useState<SavedView[]>([]);
  const [view, setView] = useState("default");
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const storageKey = viewerId ? `gradus.club.views.${viewerId}.${org.id}.coaches` : null;
  useEffect(() => {
    if (!storageKey) return;
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(parsed)) setViews(parsed.filter((v): v is SavedView => v && typeof v.name === "string" && typeof v.search === "string" && typeof v.sport === "string" && typeof v.sort === "string"));
    } catch { setViews([]); }
  }, [storageKey]);
  const sports = [...new Set(coaches.flatMap((c) => c.levels.map((l) => l.sport)))].sort();
  const weeks = metrics.data?.weeks ?? [];
  const periods = [...new Set([weekStart(), ...weeks.map((w) => w.week_start)])].sort().reverse();
  const rows = coaches.filter((c) => `${c.firstName} ${c.lastName} ${c.email ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()) && (sport === "all" || c.levels.some((l) => l.sport === sport)))
    .map((coach) => ({ coach, stats: weeks.find((w) => w.coach_id === coach.coachId && w.week_start === period) }))
    .sort((a, b) => sort === "practice" ? Number(b.stats?.practice_min ?? -1) - Number(a.stats?.practice_min ?? -1) : `${a.coach.lastName} ${a.coach.firstName}`.localeCompare(`${b.coach.lastName} ${b.coach.firstName}`));
  const totals = sumCoachWeeks(rows.flatMap((r) => r.stats ? [r.stats] : []));
  const num = (value: number | null | undefined) => value == null ? "—" : Math.round(value).toLocaleString();
  function exportRows() {
    downloadCsv("club-coaches.csv", toCsv(["Coach", "Sports", "Week (UTC)", "Students", "Practice minutes", "Target minutes", "% of target", "Sessions"], rows.map(({ coach: c, stats: s }) => [`${c.firstName} ${c.lastName}`, [...new Set(c.levels.map((l) => sportDisplayLabel(l.sport)))].join("; "), period, s?.students, s?.practice_min, s?.target_min, s ? targetPercent(s.practice_min, s.target_min) : null, s?.sessions])));
  }
  function chooseView(value: string) {
    setView(value);
    const saved = views.find((v) => v.name === value);
    setSearch(saved?.search ?? ""); setSport(saved?.sport ?? "all"); setSort(saved?.sort ?? "name");
  }
  function saveView() {
    if (!storageKey || !viewName.trim()) return;
    const next = [...views.filter((v) => v.name !== viewName.trim()), { name: viewName.trim(), search, sport, sort }];
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setViews(next); setView(viewName.trim()); setSaveOpen(false); setViewName(""); toast.success("View saved."); }
    catch { toast.error("Could not save this view on this device."); }
  }
  return <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><PageTitle>Coaches</PageTitle><div className="flex gap-2"><Button variant="outline" onClick={exportRows} disabled={!rows.length}><Download className="size-4" />Export CSV</Button><Button asChild><Link to="/org-admin/roster">Invite a coach</Link></Button></div></div>
    <div className="flex flex-wrap items-center gap-3">
      <Input aria-label="Search coaches" placeholder="Search coaches" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:w-64" />
      <FilterPill aria-label="Period" value={period} onValueChange={setPeriod} options={periods.map((p) => ({ value: p, label: `Week of ${p}` }))} className="w-auto min-w-44" />
      <FilterPill aria-label="Sport" value={sport} onValueChange={setSport} options={[{ value: "all", label: "All sports" }, ...sports.map((s) => ({ value: s, label: sportDisplayLabel(s) }))]} className="w-auto min-w-40" />
      <FilterPill aria-label="Sort" value={sort} onValueChange={setSort} options={[{ value: "name", label: "Name" }, { value: "practice", label: "Practice minutes" }]} className="w-auto min-w-40" />
      <FilterPill aria-label="Saved view" value={view} onValueChange={chooseView} options={[{ value: "default", label: "View: Default" }, ...views.map((v) => ({ value: v.name, label: `View: ${v.name}` }))]} className="w-auto min-w-40" />
      <Button variant="outline" disabled={!storageKey} onClick={() => setSaveOpen(true)}>Save view</Button>
    </div>
    {(search || sport !== "all") && <div className="flex flex-wrap gap-2">{search && <Button size="sm" variant="outline" onClick={() => setSearch("")}>{search} ×</Button>}{sport !== "all" && <Button size="sm" variant="outline" onClick={() => setSport("all")}>{sportDisplayLabel(sport)} ×</Button>}<Button size="sm" variant="ghost" onClick={() => { setSearch(""); setSport("all"); }}>Clear</Button></div>}
    {metrics.isError && <p role="alert" className="text-sm text-text-secondary">Weekly practice records become available after this draft is accepted.</p>}
    <section className="space-y-3"><h2 className="font-display text-h3">All coaches · {rows.length}</h2>
      <ClubTable><TableHeader><TableRow>{["Coach", "Sports", "Students", "Practice min", "Target min", "% of target", "Sessions / wk", "Open"].map((h, i) => <TableHead key={h} className={i > 1 && i < 7 ? "text-right" : ""}>{h}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map(({ coach: c, stats: s }) => <TableRow key={c.coachId}>
        <TableCell className="min-w-48"><Button variant="link" asChild className="min-h-11 p-0 text-text-primary"><Link to="/org-admin/coaches/$coachId" params={{ coachId: c.coachId }}>{c.firstName} {c.lastName}</Link></Button></TableCell>
        <TableCell>{[...new Set(c.levels.map((l) => sportDisplayLabel(l.sport)))].join(", ") || "Not set"}</TableCell>
        <TableCell className="text-right font-mono tabular-nums">{num(s?.students)}</TableCell><TableCell className="text-right font-mono tabular-nums">{num(s?.practice_min)}</TableCell><TableCell className="text-right font-mono tabular-nums">{num(s?.target_min)}</TableCell><TableCell className="text-right font-mono tabular-nums">{s && targetPercent(s.practice_min, s.target_min) !== null ? `${targetPercent(s.practice_min, s.target_min)}%` : "—"}</TableCell><TableCell className="text-right font-mono tabular-nums">{num(s?.sessions)}</TableCell>
        <TableCell><Button variant="ghost" asChild><Link to="/org-admin/coaches/$coachId" params={{ coachId: c.coachId }}>Open</Link></Button></TableCell>
      </TableRow>)}{!rows.length && <TableRow><TableCell colSpan={8} className="py-8 text-center text-text-secondary">No matching coaches.</TableCell></TableRow>}</TableBody>
      <TableFooter><TableRow><TableCell colSpan={2}>Club · coach totals</TableCell><TableCell className="text-right font-mono">{rows.every((r) => r.stats) ? num(totals.students) : "—"}</TableCell><TableCell className="text-right font-mono">{rows.every((r) => r.stats) ? num(totals.practice) : "—"}</TableCell><TableCell className="text-right font-mono">{rows.every((r) => r.stats) ? num(totals.target) : "—"}</TableCell><TableCell className="text-right font-mono">{rows.every((r) => r.stats) && targetPercent(totals.practice, totals.target) !== null ? `${targetPercent(totals.practice, totals.target)}%` : "—"}</TableCell><TableCell className="text-right font-mono">{rows.every((r) => r.stats) ? num(totals.sessions) : "—"}</TableCell><TableCell /></TableRow></TableFooter></ClubTable>
      <p className="text-xs text-text-secondary">Weeks use UTC. Targets are recorded coach expectations. A dash means no recorded value.</p>
    </section>
    <Sheet open={saveOpen} onOpenChange={setSaveOpen}><SheetContent><SheetHeader><SheetTitle>Save view</SheetTitle><SheetDescription>Coaches</SheetDescription></SheetHeader><div className="mt-6 space-y-3"><Label htmlFor="club-view-name">View name</Label><Input id="club-view-name" value={viewName} maxLength={60} onChange={(e) => setViewName(e.target.value)} /><Button onClick={saveView} disabled={!viewName.trim() || viewName.trim() === "default"}>Save</Button></div></SheetContent></Sheet>
  </div>;
}