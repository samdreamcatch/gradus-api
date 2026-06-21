import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getAdminOverview, searchUsers } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminHome,
});

function AdminHome() {
  const overviewFn = useServerFn(getAdminOverview);
  const searchFn = useServerFn(searchUsers);

  const { data: overview, isLoading } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => overviewFn(),
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
      <header className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">Internal</p>
        <h1 className="font-display text-h1 text-text-primary">Admin</h1>
        <p className="text-sm text-text-secondary">Read-only overview &amp; user lookup.</p>
      </header>

      <section className="space-y-3">
        <h2 className="font-display text-h3 text-text-primary">Overview</h2>
        {isLoading || !overview ? (
          <p className="text-sm text-text-secondary">Loading…</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            <Stat kind="coaches" label="Coaches" value={overview.counts.coaches} sub={`${overview.counts.coachesLast7Days} new / 7d`} />
            <Stat kind="parents" label="Parents" value={overview.counts.parents} sub={`${overview.counts.parentsLast7Days} new / 7d`} />
            <Stat kind="athletes" label="Athletes" value={overview.counts.athletes} />
            <Stat kind="plans" label="Plans" value={overview.counts.plansTotal} sub={`${overview.counts.plansActive} active`} />
            <Stat kind="beta-signups" label="Beta signups" value={overview.counts.betaParents} sub={`${overview.counts.coachCodeParents} via coach`} />
          </div>
        )}
      </section>

      {overview && (
        <section className="rounded-xl border border-divider bg-card p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-accent-ink">Status key</p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-text-secondary sm:grid-cols-2">
            <div className="flex gap-2"><dt className="font-mono uppercase text-accent-ink">onboarded</dt><dd>Coach finished onboarding flow</dd></div>
            <div className="flex gap-2"><dt className="font-mono uppercase text-accent-ink">stub</dt><dd>Coach account exists but onboarding incomplete</dd></div>
            <div className="flex gap-2"><dt className="font-mono uppercase text-accent-ink">coach code</dt><dd>Parent signed up via a coach's invite code</dd></div>
            <div className="flex gap-2"><dt className="font-mono uppercase text-accent-ink">via coach</dt><dd>Same as "coach code" (shown in lists)</dd></div>
            <div className="flex gap-2"><dt className="font-mono uppercase text-accent-ink">beta</dt><dd>Parent signed up directly with the beta invite code</dd></div>
            <div className="flex gap-2"><dt className="font-mono uppercase text-accent-ink">active / benched / draft</dt><dd>Plan status</dd></div>
          </dl>
        </section>
      )}

      {overview && (
        <section className="grid gap-6 md:grid-cols-2">
          <RecentList title="Recent coaches" items={overview.recentCoaches.map((c) => ({
            id: c.userId,
            primary: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "(no name)",
            secondary: c.email ?? "—",
            meta: new Date(c.createdAt).toLocaleDateString(),
            tag: c.onboarded ? "onboarded" : "stub",
          }))} />
          <RecentList title="Recent parents" items={overview.recentParents.map((p) => ({
            id: p.userId,
            primary: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "(no name)",
            secondary: p.email ?? "—",
            meta: new Date(p.createdAt).toLocaleDateString(),
            tag: p.viaBeta ? "beta" : "coach code",
          }))} />
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
                  <li key={`${r.kind}-${r.profileId}`}>
                    <Link
                      to="/admin/users/$userId"
                      params={{ userId: r.userId }}
                      className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-elevated"
                    >
                      <div>
                        <p className="text-sm font-semibold text-text-primary">
                          {`${r.firstName} ${r.lastName}`.trim() || "(no name)"}
                        </p>
                        <p className="text-xs text-text-secondary">{r.email ?? "—"}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-mono uppercase text-accent-ink">{r.kind}</p>
                        <p className="text-xs text-text-tertiary">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ kind, label, value, sub }: { kind: "coaches" | "parents" | "athletes" | "plans" | "beta-signups"; label: string; value: number; sub?: string }) {
  return (
    <Link
      to="/admin/list/$kind"
      params={{ kind }}
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
}: {
  title: string;
  items: { id: string; primary: string; secondary: string; meta: string; tag: string }[];
}) {
  return (
    <div className="rounded-xl border border-divider bg-card">
      <h3 className="border-b border-divider px-4 py-3 font-display text-h3 text-text-primary">{title}</h3>
      {items.length === 0 ? (
        <p className="p-4 text-sm text-text-secondary">None yet.</p>
      ) : (
        <ul className="divide-y divide-divider">
          {items.map((it) => (
            <li key={it.id}>
              <Link
                to="/admin/users/$userId"
                params={{ userId: it.id }}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-elevated"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-primary">{it.primary}</p>
                  <p className="truncate text-xs text-text-secondary">{it.secondary}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wider text-accent-ink">{it.tag}</p>
                  <p className="text-xs text-text-tertiary">{it.meta}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
