import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { chipClasses } from "@/components/ui/chip";
import { adminUsageReport, type UsageReport } from "@/lib/admin-usage.functions";
import type { MinorGroupRow } from "@/lib/analytics-report";
import { SPORTS } from "@/lib/coach-sports";

/**
 * App usage (PRD §6.12 "Reporting", milestone A1): where time goes in the iOS
 * app, which resources are read, Ask Gradus volume, and minor athletes'
 * activity by club and region. Internal admins only. Small groups are
 * floored or withheld server-side (src/lib/analytics-report.ts); there is no
 * per-coach view of minors.
 */
export const Route = createFileRoute("/_authenticated/admin/usage")({
  component: AdminUsage,
});

const WINDOWS = [
  { weeks: 4, label: "4 weeks" },
  { weeks: 12, label: "12 weeks" },
  { weeks: 52, label: "52 weeks" },
] as const;

const sportLabel = (key: string) => SPORTS.find((s) => s.key === key)?.label ?? (key || "—");

function AdminUsage() {
  const [weeks, setWeeks] = useState<4 | 12 | 52>(4);
  const [sport, setSport] = useState("");
  const [origin, setOrigin] = useState<"" | "library" | "coach">("");
  const fetchFn = useServerFn(adminUsageReport);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-usage", weeks],
    queryFn: () => fetchFn({ data: { weeks } }),
    staleTime: 60_000,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <header className="space-y-3">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-text-secondary"
        >
          <ArrowLeft className="size-3.5" /> Back to admin
        </Link>
        <div>
          <Eyebrow size="small" tone="accent-ink">
            Internal
          </Eyebrow>
          <h1 className="font-display text-h1 text-text-primary">App usage</h1>
          <p className="text-text-secondary text-sm mt-1">
            From the iOS app only. Groups under 5 people show as “&lt;5”. Minor athletes are never
            identified: their events carry no user id, and a club or region is named only when it
            has at least 10 minor athletes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button
              key={w.weeks}
              type="button"
              className={chipClasses({ tone: "muted", selected: weeks === w.weeks })}
              aria-pressed={weeks === w.weeks}
              onClick={() => setWeeks(w.weeks)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </header>

      {isLoading && <p className="text-text-secondary text-sm">Loading…</p>}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          Error: couldn't load the report. {(error as Error).message}
        </p>
      )}
      {data && (
        <>
          <AreasSection data={data} />
          <ResourcesSection
            data={data}
            sport={sport}
            origin={origin}
            onSport={setSport}
            onOrigin={setOrigin}
          />
          <AskSection data={data} />
          <MinorsSection data={data} />
        </>
      )}
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-h3 text-text-primary">{title}</h2>
        {note && <p className="text-text-secondary text-sm">{note}</p>}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-divider bg-card">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  if (!rows.length)
    return <p className="p-4 text-sm text-text-secondary">No events in this window.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-divider text-left text-text-tertiary">
          {head.map((h, i) => (
            <th key={h} scope="col" className={`px-3 py-2 font-semibold ${i ? "text-right" : ""}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-divider/60 last:border-0">
            {r.map((c, j) => (
              <td
                key={j}
                className={`px-3 py-2 ${j ? "text-right tabular-nums" : "text-text-primary"}`}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AreasSection({ data }: { data: UsageReport }) {
  const totals = useMemo(() => {
    const byArea = new Map<string, { minutes: number; byRole: Record<string, number> }>();
    for (const r of data.areas) {
      const a = byArea.get(r.area) ?? { minutes: 0, byRole: {} };
      a.minutes += r.minutes;
      a.byRole[r.role] = (a.byRole[r.role] ?? 0) + r.minutes;
      byArea.set(r.area, a);
    }
    return [...byArea.entries()].sort((x, y) => y[1].minutes - x[1].minutes);
  }, [data.areas]);
  return (
    <>
      <Section title="Time per area" note="Foreground minutes, all roles, over the window.">
        <Table
          head={["Area", "Minutes", "Coach", "Parent", "Athlete"]}
          rows={totals.map(([area, t]) => [
            area,
            t.minutes,
            t.byRole.coach ?? 0,
            t.byRole.parent ?? 0,
            t.byRole.athlete ?? 0,
          ])}
        />
      </Section>
      <Section
        title="By week and role"
        note="Adult users per cell; minors are counted in minutes only."
      >
        <Table
          head={["Week", "Role", "Area", "Minutes", "Adult users"]}
          rows={data.areas.map((r) => [r.weekStart, r.role, r.area, r.minutes, r.users])}
        />
      </Section>
    </>
  );
}

function ResourcesSection({
  data,
  sport,
  origin,
  onSport,
  onOrigin,
}: {
  data: UsageReport;
  sport: string;
  origin: "" | "library" | "coach";
  onSport: (s: string) => void;
  onOrigin: (o: "" | "library" | "coach") => void;
}) {
  const sports = [...new Set(data.resources.map((r) => r.sport).filter(Boolean))];
  const rows = data.resources.filter(
    (r) => (!sport || r.sport === sport) && (!origin || r.origin === origin),
  );
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-h3 text-text-primary">Resources</h2>
          <p className="text-text-secondary text-sm">
            Opens, readers, read time and depth (furthest page ÷ pages) per resource.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="text-sm text-text-secondary">
            <span className="sr-only">Sport</span>
            <select
              className="rounded-md border border-divider bg-card px-2 py-1"
              value={sport}
              onChange={(e) => onSport(e.target.value)}
              aria-label="Filter by sport"
            >
              <option value="">All sports</option>
              {sports.map((s) => (
                <option key={s} value={s}>
                  {sportLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-text-secondary">
            <span className="sr-only">Source</span>
            <select
              className="rounded-md border border-divider bg-card px-2 py-1"
              value={origin}
              onChange={(e) => onOrigin(e.target.value as "" | "library" | "coach")}
              aria-label="Filter by library or coach upload"
            >
              <option value="">Library and coach uploads</option>
              <option value="library">Gradus library</option>
              <option value="coach">Coach uploads</option>
            </select>
          </label>
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-divider bg-card">
        <Table
          head={[
            "Resource",
            "Sport",
            "Opens",
            "Adult readers",
            "Minor opens",
            "Read min",
            "Median read s",
            "Median depth",
            "Shares",
            "Saved offline",
          ]}
          rows={rows.map((r) => [
            `${r.title}${r.origin === "coach" ? " (coach)" : ""}`,
            sportLabel(r.sport),
            r.opens,
            r.users,
            r.minorOpens,
            r.readMinutes,
            r.medianReadSeconds ?? "—",
            r.medianDepth === null ? "—" : `${Math.round(r.medianDepth * 100)}%`,
            r.shares,
            r.offlineSaves,
          ])}
        />
      </div>
    </section>
  );
}

function AskSection({ data }: { data: UsageReport }) {
  return (
    <Section
      title="Ask Gradus"
      note="Questions per week, how many were grounded in Gradus sources, and safety answers."
    >
      <Table
        head={["Week", "Questions", "Grounded", "Safety", "Saved", "Source taps"]}
        rows={data.ask.map((r) => [
          r.weekStart,
          r.questions,
          r.grounded,
          r.safety,
          r.saved,
          r.sourceTaps,
        ])}
      />
    </Section>
  );
}

function minorCells(r: MinorGroupRow): (string | number)[] {
  if (r.withheld) return [r.label, "withheld", "—", "—", "—", "—", "—"];
  return [
    r.label,
    r.minors ?? "—",
    r.events,
    r.safeSportOpens,
    r.safeSportPerMinor ?? "—",
    r.resourceOpens,
    r.screenMinutes,
  ];
}

function MinorsSection({ data }: { data: UsageReport }) {
  const head = [
    "Group",
    "Minor athletes",
    "Events",
    "Safe Sport opens",
    "Per minor",
    "Resource opens",
    "Minutes",
  ];
  const baseline = data.minors.medianSafeSportPerMinor;
  return (
    <>
      <Section
        title="Minor athletes by club"
        note={`Clubs with at least 10 minor athletes. Median Safe Sport opens per minor athlete across named clubs: ${baseline ?? "—"}. “Withheld” hides a group of 1–9 minor athletes. No per-coach view exists.`}
      >
        <Table head={head} rows={data.minors.clubs.map(minorCells)} />
      </Section>
      <Section
        title="Minor athletes by region"
        note="Regions with at least 10 minor athletes. A region's total is withheld when the clubs too small to name inside it would otherwise be found by subtraction."
      >
        <Table head={head} rows={data.minors.regions.map(minorCells)} />
      </Section>
    </>
  );
}
