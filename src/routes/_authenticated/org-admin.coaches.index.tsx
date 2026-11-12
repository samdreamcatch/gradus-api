import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { clubCoachesOptions } from "@/components/org-admin/club-coaches-data";
import { getClubCoachWeeks } from "@/lib/club-coaches.functions";
import { weekStart, targetPercent, sumCoachWeeks } from "@/lib/club-coach-metrics";
import { sportDisplayLabel } from "@/lib/coach-sports";
import { downloadCsv, toCsv } from "@/lib/csv";
import { ClubDataGrid, useClubGrid, type ClubColumn } from "@/components/org-admin/club-data-grid";
import { ClubGridToolbar } from "@/components/org-admin/club-grid-toolbar";
import { ClubPageHeader } from "@/components/org-admin/club-page-header";
import { ClubWeekStepper } from "@/components/org-admin/club-week-stepper";
import { ClubMeter } from "@/components/org-admin/club-meter";
import { ClubNumber } from "@/components/org-admin/club-number";
import { ClubPersonCell } from "@/components/org-admin/club-person-cell";
import { Button } from "@/components/ui/button";
import { FilterPill } from "@/components/ui/filter-pill";

export const Route = createFileRoute("/_authenticated/org-admin/coaches/")({
  head: () => ({
    meta: [
      { title: "Coaching · Gradus Club" },
      { name: "description", content: "Club coach directory and private weekly practice totals." },
      { property: "og:title", content: "Coaching · Gradus Club" },
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
  coach: {
    coachId: string;
    firstName: string;
    lastName: string;
    email?: string | null;
    levels: { sport: string }[];
  };
  stats?: {
    students: number | null;
    practice_min: number | null;
    target_min: number | null;
    sessions: number | null;
  };
};
const mono = "font-mono tabular-nums";
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
    render: (r) => (
      <ClubPersonCell name={`${r.coach.firstName} ${r.coach.lastName}`} email={r.coach.email} />
    ),
    sortValue: (r) => `${r.coach.lastName} ${r.coach.firstName}`.toLowerCase(),
  },
  {
    key: "sports",
    label: "Sports",
    render: (r) =>
      sportsOf(r).length ? (
        sportsOf(r).join(", ")
      ) : (
        <Link
          to="/org-admin/coaches/$coachId"
          params={{ coachId: r.coach.coachId }}
          className="underline underline-offset-4"
          onClick={(e) => e.stopPropagation()}
        >
          Set sport
        </Link>
      ),
    sortValue: (r) => sportsOf(r).join(", "),
    groupValue: (r) => sportsOf(r)[0] ?? "No sport",
  },
  {
    key: "students",
    label: "Students",
    align: "right",
    className: mono,
    numeric: (r) => r.stats?.students ?? null,
    sortValue: (r) => r.stats?.students ?? null,
    footer: (rows) => <ClubNumber value={allStats(rows) ? totalsOf(rows).students : null} />,
  },
  {
    key: "practice",
    label: "Practice min",
    align: "right",
    className: mono,
    numeric: (r) => r.stats?.practice_min ?? null,
    sortValue: (r) => r.stats?.practice_min ?? null,
    footer: (rows) => <ClubNumber value={allStats(rows) ? totalsOf(rows).practice : null} />,
  },
  {
    key: "target",
    label: "Target min",
    align: "right",
    className: mono,
    numeric: (r) => r.stats?.target_min ?? null,
    sortValue: (r) => r.stats?.target_min ?? null,
    footer: (rows) => <ClubNumber value={allStats(rows) ? totalsOf(rows).target : null} />,
  },
  {
    key: "pct",
    label: "% of target",
    align: "right",
    className: mono,
    render: (r) => <ClubMeter value={r.stats?.practice_min} target={r.stats?.target_min} />,
    sortValue: (r) => pctOf(r.stats),
    footer: (rows) => {
      const t = totalsOf(rows);
      return (
        <ClubMeter
          value={allStats(rows) ? t.practice : null}
          target={allStats(rows) ? t.target : null}
        />
      );
    },
  },
  {
    key: "sessions",
    label: "Sessions / wk",
    align: "right",
    className: mono,
    numeric: (r) => r.stats?.sessions ?? null,
    sortValue: (r) => r.stats?.sessions ?? null,
    footer: (rows) => <ClubNumber value={allStats(rows) ? totalsOf(rows).sessions : null} />,
  },
];

function CoachesPage() {
  const {
    data: { org, coaches },
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
  const sports = [...new Set(coaches.flatMap((c) => c.levels.map((l) => l.sport)))].sort();
  const weeks = metrics.data?.weeks ?? [];
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
  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 font-sans md:px-6 md:py-8">
      <ClubPageHeader
        title="Coaching"
        actions={
          <>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={exportRows}
              disabled={!rows.length}
            >
              Export
            </Button>
            <Button asChild className="min-h-11">
              <Link to="/org-admin/roster">Invite a coach</Link>
            </Button>
          </>
        }
      />
      <ClubGridToolbar
        search={search}
        onSearchChange={setSearch}
        searchLabel="Search coaches"
        activeFilters={(search ? 1 : 0) + (sport !== "all" ? 1 : 0)}
        onClear={() => {
          setSearch("");
          setSport("all");
        }}
        end={grid.menu}
      >
        <ClubWeekStepper value={period} onValueChange={setPeriod} />
        <FilterPill
          aria-label="Sport"
          value={sport}
          onValueChange={setSport}
          options={[
            { value: "all", label: "All sports" },
            ...sports.map((s) => ({ value: s, label: sportDisplayLabel(s) })),
          ]}
          className="min-h-11 w-auto min-w-40 border-border-strong font-sans"
        />
      </ClubGridToolbar>
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
        noun={{ one: "coach", many: "coaches" }}
        showFooter
      />
    </div>
  );
}
