import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getAdminOverview, searchUsers, setUserTestFlag, getDailyActiveUsers } from "@/lib/admin.functions";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const searchSchema = z.object({
  test: fallback(z.boolean(), false).default(false),
});

export const Route = createFileRoute("/_authenticated/admin/")({
  validateSearch: zodValidator(searchSchema),
  component: AdminHome,
});

function AdminHome() {
  const { test: includeTest } = Route.useSearch();
  const navigate = useNavigate();
  const overviewFn = useServerFn(getAdminOverview);
  const searchFn = useServerFn(searchUsers);
  const toggleFn = useServerFn(setUserTestFlag);
  const qc = useQueryClient();

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const toggleTest = async (userId: string, next: boolean) => {
    await toggleFn({ data: { userId, isTest: next } });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin-overview"] }),
      qc.invalidateQueries({ queryKey: ["admin-search"] }),
      qc.invalidateQueries({ queryKey: ["admin-user", userId] }),
    ]);
  };

  const { data: overview, isLoading } = useQuery({
    queryKey: ["admin-overview", includeTest],
    queryFn: () => overviewFn({ data: { includeTest } }),
  });

  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const { data: results, isFetching } = useQuery({
    queryKey: ["admin-search", submitted],
    queryFn: () => searchFn({ data: { query: submitted } }),
    enabled: submitted.length >= 2,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-10">
      <header className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">Internal</p>
          <h1 className="font-display text-h1 text-text-primary">Admin</h1>
          
        </div>
        <div className="flex items-center gap-3">
          <Link
            from={Route.fullPath}
            search={{ test: !includeTest }}
            className={`rounded-pill border px-3 py-2 text-xs font-semibold uppercase tracking-wider transition ${
              includeTest
                ? "border-accent bg-accent text-accent-foreground"
                : "border-divider bg-card text-text-secondary hover:bg-elevated"
            }`}
            title="Toggle test users"
          >
            {includeTest ? "Test users: on" : "Test users: hidden"}
          </Link>
          <Link
            to="/admin/map"
            search={{ test: includeTest }}
            className="rounded-pill border border-accent bg-accent px-4 py-2 text-xs font-semibold uppercase tracking-wider text-accent-foreground hover:opacity-90"
          >
            Connection map →
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-pill border border-divider bg-card px-3 py-2 text-xs font-semibold uppercase tracking-wider text-text-secondary hover:bg-elevated hover:text-text-primary"
          >
            Sign out
          </button>
        </div>
      </header>

      {overview?.betaInviteCode && (
        <section className="rounded-lg border border-divider bg-card p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">Beta invite code</p>
            <p className="font-mono text-h3 text-text-primary tracking-widest mt-1">{overview.betaInviteCode}</p>
          </div>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(overview.betaInviteCode!)}
            className="rounded-pill border border-divider bg-elevated px-3 py-2 text-xs font-semibold uppercase tracking-wider text-text-secondary hover:text-text-primary"
          >
            Copy
          </button>
        </section>
      )}



      <section className="space-y-3">
        <h2 className="font-display text-h3 text-text-primary">User lookup</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(query.trim());
          }}
          className="flex gap-2"
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
          />
          <Button type="submit" disabled={query.trim().length < 2}>
            Search
          </Button>
        </form>

        {submitted.length >= 2 && (
          <div className="rounded-xl border border-divider bg-card">
            {isFetching ? (
              <p className="p-4 text-sm text-text-secondary">Searching…</p>
            ) : (results?.results ?? []).length === 0 ? (
              <p className="p-4 text-sm text-text-secondary">No matches.</p>
            ) : (
              <ul className="divide-y divide-divider">
                {results!.results.map((r) => (
                  <li key={`${r.kind}-${r.profileId}`} className="flex items-center gap-2 px-4 py-3 hover:bg-elevated">
                    <Link
                      to="/admin/users/$userId"
                      params={{ userId: r.userId }}
                      className="flex flex-1 items-center justify-between gap-4 min-w-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-text-primary">
                          {`${r.firstName} ${r.lastName}`.trim() || "(no name)"}
                          {r.isTest && (
                            <span className="ml-2 rounded-pill border border-divider bg-elevated px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-text-tertiary">test</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-text-secondary">{r.email ?? "—"}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-mono uppercase text-accent-ink">{r.kind}</p>
                        <p className="text-xs text-text-tertiary">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </Link>
                    <TestToggle isTest={r.isTest} onToggle={() => toggleTest(r.userId, !r.isTest)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-h3 text-text-primary">Overview</h2>
        {isLoading || !overview ? (
          <p className="text-sm text-text-secondary">Loading…</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            <Stat kind="coaches" label="Coaches" value={overview.counts.coaches} sub={`${overview.counts.coachesLast7Days} new / 7d`} includeTest={includeTest} />
            <Stat kind="parents" label="Parents" value={overview.counts.parents} sub={`${overview.counts.parentsLast7Days} new / 7d`} includeTest={includeTest} />
            <Stat kind="athletes" label="Athletes" value={overview.counts.athletes} includeTest={includeTest} />
            <Stat kind="plans" label="Plans" value={overview.counts.plansTotal} sub={`${overview.counts.plansActive} active`} includeTest={includeTest} />
            <Stat kind="beta-signups" label="Beta signups" value={overview.counts.betaParents} sub="No coach yet" includeTest={includeTest} />
            <Stat kind="parents" filter="coach" label="Via coach code" value={overview.counts.coachCodeParents} sub="Signed up through a coach" includeTest={includeTest} />
          </div>
        )}
      </section>

      <DauChart includeTest={includeTest} />





    </div>
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
          <h2 className="font-display text-h3 text-text-primary">Daily active users</h2>
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



function Stat({ kind, label, value, sub, includeTest, filter = "all" }: { kind: "coaches" | "parents" | "athletes" | "plans" | "beta-signups"; label: string; value: number; sub?: string; includeTest: boolean; filter?: string }) {
  return (
    <Link
      to="/admin/list/$kind"
      params={{ kind }}
      search={{ filter, test: includeTest }}
      className="rounded-xl border border-divider bg-card p-4 transition hover:border-accent/50 hover:bg-elevated"
    >
      <p className="text-xs uppercase tracking-wider text-text-tertiary">{label}</p>
      <p className="mt-1 font-display text-h2 text-text-primary">{value}</p>
      {sub && <p className="text-xs text-text-secondary">{sub}</p>}
    </Link>
  );
}

function RecentList({
  title,
  items,
  onToggleTest,
}: {
  title: string;
  items: { id: string; primary: string; secondary: string; meta: string; tag: string; isTest: boolean }[];
  onToggleTest: (userId: string, next: boolean) => void | Promise<void>;
}) {
  return (
    <div className="rounded-xl border border-divider bg-card">
      <h3 className="border-b border-divider px-4 py-3 font-display text-h3 text-text-primary">{title}</h3>
      {items.length === 0 ? (
        <p className="p-4 text-sm text-text-secondary">None yet.</p>
      ) : (
        <ul className="divide-y divide-divider">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 px-4 py-3 hover:bg-elevated">
              <Link
                to="/admin/users/$userId"
                params={{ userId: it.id }}
                className="flex flex-1 items-center justify-between gap-3 min-w-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-primary">
                    {it.primary}
                    {it.isTest && (
                      <span className="ml-2 rounded-pill border border-divider bg-elevated px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-text-tertiary">test</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-text-secondary">{it.secondary}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs uppercase tracking-wider text-accent-ink">{it.tag}</p>
                  <p className="text-xs text-text-tertiary">{it.meta}</p>
                </div>
              </Link>
              <TestToggle isTest={it.isTest} onToggle={() => onToggleTest(it.id, !it.isTest)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TestToggle({ isTest, onToggle }: { isTest: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      title={isTest ? "Unmark as test user" : "Mark as test user"}
      className={`shrink-0 rounded-pill border px-2 py-1 text-[10px] font-mono uppercase tracking-wider transition ${
        isTest
          ? "border-accent bg-accent text-accent-foreground"
          : "border-divider bg-card text-text-tertiary hover:bg-elevated"
      }`}
    >
      {isTest ? "test ✓" : "test"}
    </button>
  );
}
