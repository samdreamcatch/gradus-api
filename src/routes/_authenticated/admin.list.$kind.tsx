import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { getAdminList } from "@/lib/admin.functions";

const KIND_CONFIG = {
  coaches: {
    title: "Coaches",
    filters: [
      { value: "all", label: "All" },
      { value: "onboarded", label: "Onboarded" },
      { value: "stub", label: "Stub" },
    ],
  },
  parents: {
    title: "Parents",
    filters: [
      { value: "all", label: "All" },
      { value: "coach", label: "Via coach" },
      { value: "beta", label: "Beta" },
    ],
  },
  athletes: {
    title: "Athletes",
    filters: [{ value: "all", label: "All" }],
  },
  plans: {
    title: "Plans",
    filters: [
      { value: "all", label: "All" },
      { value: "active", label: "Active" },
      { value: "benched", label: "Benched" },
      { value: "draft", label: "Draft" },
    ],
  },
  "beta-signups": {
    title: "Beta signups",
    filters: [
      { value: "all", label: "All" },
      { value: "with-email", label: "With email" },
      { value: "no-email", label: "No email" },
    ],
  },
} as const;

type Kind = keyof typeof KIND_CONFIG;
const KINDS = Object.keys(KIND_CONFIG) as Kind[];

const searchSchema = z.object({
  filter: fallback(z.string(), "all").default("all"),
  test: fallback(z.boolean(), false).default(false),
});

export const Route = createFileRoute("/_authenticated/admin/list/$kind")({
  validateSearch: zodValidator(searchSchema),
  component: AdminList,
});

function AdminList() {
  const { kind } = Route.useParams();
  const { filter, test: includeTest } = Route.useSearch();
  const fn = useServerFn(getAdminList);

  if (!KINDS.includes(kind as Kind)) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <p className="text-sm text-destructive">Unknown list: {kind}</p>
      </div>
    );
  }

  const cfg = KIND_CONFIG[kind as Kind];
  const { data, isLoading } = useQuery({
    queryKey: ["admin-list", kind, filter, includeTest],
    queryFn: () => fn({ data: { kind: kind as Kind, filter, includeTest } }),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <Link to="/admin" className="text-sm text-accent-ink underline-offset-4 hover:underline">
        ← Back to admin
      </Link>

      <header className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">Admin</p>
        <h1 className="font-display text-h1 text-text-primary">{cfg.title}</h1>
        {data && (
          <p className="text-sm text-text-secondary">
            {data.rows.length} result{data.rows.length === 1 ? "" : "s"}
            {data.rows.length === 200 ? " (showing first 200)" : ""}
          </p>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {cfg.filters.length > 1 && cfg.filters.map((f) => (
          <Link
            key={f.value}
            from={Route.fullPath}
            search={(prev: any) => ({ ...prev, filter: f.value })}
            className={`rounded-pill border px-3 py-1 text-xs font-medium uppercase tracking-wider transition ${
              filter === f.value
                ? "border-accent bg-accent text-accent-foreground"
                : "border-divider bg-card text-text-secondary hover:bg-elevated"
            }`}
          >
            {f.label}
          </Link>
        ))}
        <Link
          from={Route.fullPath}
          search={(prev: any) => ({ ...prev, test: !includeTest })}
          className={`ml-auto rounded-pill border px-3 py-1 text-xs font-medium uppercase tracking-wider transition ${
            includeTest
              ? "border-accent bg-accent text-accent-foreground"
              : "border-divider bg-card text-text-secondary hover:bg-elevated"
          }`}
        >
          {includeTest ? "Test users: on" : "Test users: hidden"}
        </Link>
      </div>

      <div className="rounded-xl border border-divider bg-card">
        {isLoading ? (
          <p className="p-4 text-sm text-text-secondary">Loading…</p>
        ) : (data?.rows ?? []).length === 0 ? (
          <p className="p-4 text-sm text-text-secondary">No results.</p>
        ) : (
          <ul className="divide-y divide-divider">
            {data!.rows.map((r) => {
              const inner = (
                <div className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-elevated">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-primary">{r.name}</p>
                    {r.email && <p className="truncate text-xs text-text-secondary">{r.email}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-mono uppercase text-accent-ink">{r.tag}</p>
                    <p className="text-xs text-text-tertiary">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              );
              return (
                <li key={r.id}>
                  {r.userId ? (
                    <Link to="/admin/users/$userId" params={{ userId: r.userId }}>
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
