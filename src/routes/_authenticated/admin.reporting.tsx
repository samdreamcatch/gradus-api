import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { getDailyActiveUsers, getAdminReporting } from "@/lib/admin.functions";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const searchSchema = z.object({
  test: fallback(z.boolean(), false).default(false),
});

export const Route = createFileRoute("/_authenticated/admin/reporting")({
  validateSearch: zodValidator(searchSchema),
  component: AdminReporting,
});

function AdminReporting() {
  const { test: includeTest } = Route.useSearch();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <header>
        <h2 className="font-display text-h2 text-text-primary">Reporting</h2>
        <p className="text-sm text-text-secondary">Growth, activation, and activity metrics.</p>
      </header>
      <ReportingPanel includeTest={includeTest} />
      <DauChart includeTest={includeTest} />
    </div>
  );
}

function ReportingPanel({ includeTest }: { includeTest: boolean }) {
  const reportFn = useServerFn(getAdminReporting);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-reporting", includeTest],
    queryFn: () => reportFn({ data: { includeTest } }),
  });

  return (
    <section className="space-y-3">
      {isLoading || !data ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : (
        <Tabs defaultValue="coaches" className="w-full">
          <TabsList>
            <TabsTrigger value="coaches">Coaches</TabsTrigger>
            <TabsTrigger value="parents">Parents</TabsTrigger>
            <TabsTrigger value="athletes">Athletes</TabsTrigger>
          </TabsList>

          <TabsContent value="coaches" className="mt-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              <Stat kind="coaches" label="Total" value={data.coaches.total} includeTest={includeTest} />
              <Stat kind="coaches" label="New / 7d" value={data.coaches.new7} includeTest={includeTest} />
              <Stat kind="coaches" filter="onboarded" label="Onboarded" value={data.coaches.onboarded} includeTest={includeTest} />
              <Metric label="With athletes" value={data.coaches.withAthletes} />
              <Stat kind="plans" filter="active" label="Active plans" value={data.coaches.activePlans} includeTest={includeTest} />
              <Metric label="Templates" value={data.coaches.templates} />
              <Metric label="Active / 7d" value={data.coaches.active7} />
              <Metric label="Active / 30d" value={data.coaches.active30} />
            </div>
          </TabsContent>

          <TabsContent value="parents" className="mt-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              <Stat kind="parents" label="Total" value={data.parents.total} includeTest={includeTest} />
              <Stat kind="parents" label="New / 7d" value={data.parents.new7} includeTest={includeTest} />
              <Stat kind="parents" filter="coach" label="Via coach code" value={data.parents.viaCoach} includeTest={includeTest} />
              <Stat kind="beta-signups" label="Beta (no coach)" value={data.parents.beta} includeTest={includeTest} />
              <Metric label="With athletes" value={data.parents.withAthletes} />
              <Metric label="Active / 7d" value={data.parents.active7} />
              <Metric label="Active / 30d" value={data.parents.active30} />
            </div>
          </TabsContent>

          <TabsContent value="athletes" className="mt-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              <Stat kind="athletes" label="Total" value={data.athletes.total} includeTest={includeTest} />
              <Stat kind="athletes" label="New / 7d" value={data.athletes.new7} includeTest={includeTest} />
              <Metric label="With coach" value={data.athletes.withCoach} />
              <Stat kind="plans" filter="active" label="Active plans" value={data.athletes.activePlans} includeTest={includeTest} />
              <Metric label="Sessions / 7d" value={data.athletes.sessions7} />
              <Metric label="Active / 7d" value={data.athletes.active7} />
              <Metric label="Active / 30d" value={data.athletes.active30} />
            </div>
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-divider bg-card px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <Eyebrow size="micro" tone="tertiary" weight="normal" tracking="wide" className="truncate">{label}</Eyebrow>
        <p className="font-display text-h3 leading-none text-text-primary">{value}</p>
      </div>
    </div>
  );
}

function Stat({ kind, label, value, sub, includeTest, filter = "all" }: { kind: "coaches" | "parents" | "athletes" | "plans" | "beta-signups"; label: string; value: number; sub?: string; includeTest: boolean; filter?: string }) {
  return (
    <Link
      to="/admin/list/$kind"
      params={{ kind }}
      search={{ filter, test: includeTest }}
      className="rounded-xl border border-divider bg-card px-3 py-2 transition hover:border-accent/50 hover:bg-elevated"
    >
      <div className="flex items-baseline justify-between gap-2">
        <Eyebrow size="micro" tone="tertiary" weight="normal" tracking="wide" className="truncate">{label}</Eyebrow>
        <p className="font-display text-h3 leading-none text-text-primary">{value}</p>
      </div>
      {sub && <p className="mt-0.5 text-[11px] text-text-secondary truncate">{sub}</p>}
    </Link>
  );
}

function DauChart({ includeTest }: { includeTest: boolean }) {
  const dauFn = useServerFn(getDailyActiveUsers);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-dau", includeTest],
    queryFn: () => dauFn({ data: { days: 30, includeTest } }),
  });

  const series = data?.series ?? [];
  const peak = series.reduce((m, p) => Math.max(m, p.activeUsers), 0);
  const total = series.reduce((s, p) => s + p.activeUsers, 0);
  const avg = series.length ? Math.round((total / series.length) * 10) / 10 : 0;

  return (
    <section className="rounded-xl border border-divider bg-card p-4">
      <div className="flex items-end justify-between gap-4 mb-3">
        <div>
          <h3 className="font-display text-h3 text-text-primary">Daily active users</h3>
          <p className="text-xs text-text-secondary">
            Last 30 days · unique users who sent a message, logged a session, or saved a lesson wrap-up.
          </p>
        </div>
        <div className="text-right text-xs text-text-secondary shrink-0">
          <p><span className="font-mono text-text-primary">{peak}</span> peak</p>
          <p><span className="font-mono text-text-primary">{avg}</span> avg / day</p>
        </div>
      </div>
      <div className="h-56 w-full">
        {isLoading ? (
          <p className="text-sm text-text-secondary">Loading…</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="dauFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--divider)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--divider)" }}
                tickFormatter={(d: string) => {
                  const dt = new Date(d);
                  return `${dt.getMonth() + 1}/${dt.getDate()}`;
                }}
                minTickGap={24}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--divider)" }}
                width={32}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover, var(--card))",
                  border: "1px solid var(--divider)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "var(--text-primary)",
                }}
                labelFormatter={(d) => new Date(d as string).toLocaleDateString()}
                formatter={(v: number) => [v, "Active users"]}
              />
              <Area
                type="monotone"
                dataKey="activeUsers"
                stroke="var(--accent)"
                strokeWidth={2}
                fill="url(#dauFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
