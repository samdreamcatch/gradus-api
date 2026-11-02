import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import { ClubDataGrid, useClubGrid, type ClubColumn } from "@/components/org-admin/club-data-grid";
import { ClubGridToolbar, ClubGridCount } from "@/components/org-admin/club-grid-toolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterPill } from "@/components/ui/filter-pill";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/org-admin/coaches/")({
  head: () => ({
    meta: [
      { title: "Coaches · Gradus Club" },
      { name: "description", content: "Club coach directory and private weekly practice totals." },
      { property: "og:title", content: "Coaches · Gradus Club" },
      {
        property: "og:description",
        content: "Club coach directory and private weekly practice totals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(clubCoachesOptions()),
  component: CoachesPage,
});

type CoachRow = {
  coach: { coachId: string; firstName: string; lastName: string; levels: { sport: string }[] };
  stats?: {
    students: number | null;
    practice_min: number | null;
    target_min: number | null;
    sessions: number | null;
  };
};
const mono = "font-mono tabular-nums";
const fmt = (value: number | null | undefined) =>
  value == null ? "—" : Math.round(Number(value)).toLocaleString();
const pctOf = (s: CoachRow["stats"]) =>
  s ? targetPercent(Number(s.practice_min), Number(s.target_min)) : null;
const sportsOf = (r: CoachRow) => [
  ...new Set(r.coach.levels.map((l) => sportDisplayLabel(l.sport))),
];
const allStats = (rows: CoachRow[]) => rows.length > 0 && rows.every((r) => r.stats);
const totalsOf = (rows: CoachRow[]) =>
  sumCoachWeeks(rows.flatMap((r) => (r.stats ? [r.stats as never] : [])));
const COLUMNS: ClubColumn<CoachRow>[] = [
  {
    key: "coach",
    label: "Coach",
    className: "min-w-48 font-medium",
    render: (r) => `${r.coach.firstName} ${r.coach.lastName}`.trim() || "Coach profile",
    sortValue: (r) => `${r.coach.lastName} ${r.coach.firstName}`.toLowerCase(),
  },
  {
    key: "sports",
    label: "Sports",
    render: (r) => sportsOf(r).join(", ") || "Not set",
    sortValue: (r) => sportsOf(r).join(", "),
    groupValue: (r) => sportsOf(r)[0] ?? "Not set",
  },
  {
    key: "students",
    label: "Students",
    align: "right",
    className: mono,
    render: (r) => fmt(r.stats?.students),
    sortValue: (r) => r.stats?.students ?? null,
    footer: (rows) => (allStats(rows) ? fmt(totalsOf(rows).students) : "—"),
  },
  {
    key: "practice",
    label: "Practice min",
    align: "right",
    className: mono,
    render: (r) => fmt(r.stats?.practice_min),
    sortValue: (r) => r.stats?.practice_min ?? null,
    footer: (rows) => (allStats(rows) ? fmt(totalsOf(rows).practice) : "—"),
  },
  {
    key: "target",
    label: "Target min",
    align: "right",
    className: mono,
    render: (r) => fmt(r.stats?.target_min),
    sortValue: (r) => r.stats?.target_min ?? null,
    footer: (rows) => (allStats(rows) ? fmt(totalsOf(rows).target) : "—"),
  },
  {
    key: "pct",
    label: "% of target",
    align: "right",
    className: mono,
    render: (r) => {
      const v = pctOf(r.stats);
      return v == null ? "—" : `${v}%`;
    },
    sortValue: (r) => pctOf(r.stats),
    footer: (rows) => {
      const t = totalsOf(rows);
      const v = allStats(rows) ? targetPercent(t.practice, t.target) : null;
      return v == null ? "—" : `${v}%`;
    },
  },
  {
    key: "sessions",
    label: "Sessions / wk",
    align: "right",
    className: mono,
    render: (r) => fmt(r.stats?.sessions),
    sortValue: (r) => r.stats?.sessions ?? null,
    footer: (rows) => (allStats(rows) ? fmt(totalsOf(rows).sessions) : "—"),
  },
];

type SavedView = { name: string; search: string; sport: string; sort: string };

function CoachesPage() {
  const {
    data: { org, coaches, viewerId },
  } = useSuspenseQuery(clubCoachesOptions());
  const read = useServerFn(getClubCoachWeeks);
  const metrics = useQuery({
    queryKey: ["club-coach-weeks", org.id],
    queryFn: () => read({ data: { organizationId: org.id } }),
    retry: false,
  });
  const [period, setPeriod] = useState(weekStart());
  const [search, setSearch] = useState("");
  const [sport, setSport] = useState("all");
  const sort = "name";
  const [views, setViews] = useState<SavedView[]>([]);
  const [view, setView] = useState("default");
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const storageKey = viewerId ? `gradus.club.views.${viewerId}.${org.id}.coaches` : null;
  useEffect(() => {
    if (!storageKey) return;
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(parsed))
        setViews(
          parsed.filter(
            (v): v is SavedView =>
              v &&
              typeof v.name === "string" &&
              typeof v.search === "string" &&
              typeof v.sport === "string" &&
              typeof v.sort === "string",
          ),
        );
    } catch {
      setViews([]);
    }
  }, [storageKey]);
  const sports = [...new Set(coaches.flatMap((c) => c.levels.map((l) => l.sport)))].sort();
  const weeks = metrics.data?.weeks ?? [];
  const periods = [...new Set([weekStart(), ...weeks.map((w) => w.week_start)])].sort().reverse();
  const rows = coaches
    .filter(
      (c) =>
        `${c.firstName} ${c.lastName} ${c.email ?? ""}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()) &&
        (sport === "all" || c.levels.some((l) => l.sport === sport)),
    )
    .map((coach) => ({
      coach,
      stats: weeks.find((w) => w.coach_id === coach.coachId && w.week_start === period),
    }));
  const grid = useClubGrid<CoachRow>("coaching", COLUMNS, rows as CoachRow[]);
  const navigate = useNavigate();
  function exportRows() {
    downloadCsv(
      "club-coaches.csv",
      toCsv(
        [
          "Coach",
          "Sports",
          "Week (UTC)",
          "Students",
          "Practice minutes",
          "Target minutes",
          "% of target",
          "Sessions",
        ],
        rows.map(({ coach: c, stats: s }) => [
          `${c.firstName} ${c.lastName}`,
          [...new Set(c.levels.map((l) => sportDisplayLabel(l.sport)))].join("; "),
          period,
          s?.students,
          s?.practice_min,
          s?.target_min,
          s ? targetPercent(s.practice_min, s.target_min) : null,
          s?.sessions,
        ]),
      ),
    );
  }
  function chooseView(value: string) {
    setView(value);
    const saved = views.find((v) => v.name === value);
    setSearch(saved?.search ?? "");
    setSport(saved?.sport ?? "all");
  }
  function saveView() {
    if (!storageKey || !viewName.trim()) return;
    const next = [
      ...views.filter((v) => v.name !== viewName.trim()),
      { name: viewName.trim(), search, sport, sort },
    ];
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setViews(next);
      setView(viewName.trim());
      setSaveOpen(false);
      setViewName("");
      toast.success("View saved.");
    } catch {
      toast.error("Could not save this view on this device.");
    }
  }
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle subtitle={org.name}>Coaching</PageTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportRows} disabled={!rows.length}>
            <Download className="size-4" />
            Export
          </Button>
          <Button asChild size="sm">
            <Link to="/org-admin/roster">Invite a coach</Link>
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <ClubGridToolbar
          search={search}
          onSearchChange={setSearch}
          searchLabel="Search coaches"
          activeFilters={(search ? 1 : 0) + (sport !== "all" ? 1 : 0)}
          onClear={() => {
            setSearch("");
            setSport("all");
          }}
        >
          <FilterPill
            aria-label="Period"
            value={period}
            onValueChange={setPeriod}
            options={periods.map((p) => ({ value: p, label: `Week of ${p}` }))}
            className="w-auto min-w-44"
          />
          <FilterPill
            aria-label="Sport"
            value={sport}
            onValueChange={setSport}
            options={[
              { value: "all", label: "All sports" },
              ...sports.map((s) => ({ value: s, label: sportDisplayLabel(s) })),
            ]}
            className="w-auto min-w-40"
          />
          <FilterPill
            aria-label="Saved view"
            value={view}
            onValueChange={chooseView}
            options={[
              { value: "default", label: "View: Default" },
              ...views.map((v) => ({ value: v.name, label: `View: ${v.name}` })),
            ]}
            className="w-auto min-w-40"
          />
          <Button
            variant="ghost"
            size="sm"
            className="press-soft"
            disabled={!storageKey}
            onClick={() => setSaveOpen(true)}
          >
            Save view
          </Button>
          <span className="mx-1 h-6 w-px bg-divider" aria-hidden />
          {grid.menu}
        </ClubGridToolbar>
        <ClubGridCount shown={rows.length} total={coaches.length} noun="coaches" />
      </div>
      {metrics.isError && (
        <p role="alert" className="text-sm text-text-secondary">
          Weekly practice records become available after this draft is accepted.
        </p>
      )}
      <ClubDataGrid
        grid={grid}
        rowKey={(r) => r.coach.coachId}
        onRowClick={(r) =>
          navigate({ to: "/org-admin/coaches/$coachId", params: { coachId: r.coach.coachId } })
        }
        rowLabel={(r) => `${r.coach.firstName} ${r.coach.lastName}`}
        filtered={!!coaches.length}
        onClear={() => {
          setSearch("");
          setSport("all");
        }}
        empty="No coaches have joined this club yet."
        showFooter
      />
      <p className="text-xs text-text-secondary">
        Weeks use UTC. Targets are recorded coach expectations. A dash means no recorded value.
        Click a coach to open their profile.
      </p>
      <Sheet open={saveOpen} onOpenChange={setSaveOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Save view</SheetTitle>
            <SheetDescription>Coaches</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-3">
            <Label htmlFor="club-view-name">View name</Label>
            <Input
              id="club-view-name"
              value={viewName}
              maxLength={60}
              onChange={(e) => setViewName(e.target.value)}
            />
            <Button onClick={saveView} disabled={!viewName.trim() || viewName.trim() === "default"}>
              Save
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
