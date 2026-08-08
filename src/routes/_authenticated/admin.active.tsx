import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { getAdminActiveUsers } from "@/lib/admin.functions";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import { chipClasses } from "@/components/ui/chip";

const searchSchema = z.object({
  role: fallback(z.enum(["all", "coaches", "parents", "athletes"]), "all").default("all"),
  days: fallback(z.number(), 7).default(7),
  date: z.string().optional(),
  test: fallback(z.boolean(), false).default(false),
});

export const Route = createFileRoute("/_authenticated/admin/active")({
  validateSearch: zodValidator(searchSchema),
  component: AdminActive,
});

const ROLE_LABEL: Record<string, string> = {
  all: "Everyone",
  coaches: "Coaches",
  parents: "Parents",
  athletes: "Athletes",
};

function AdminActive() {
  const { role, days, date, test: includeTest } = Route.useSearch();
  const fn = useServerFn(getAdminActiveUsers);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-active", role, days, date ?? null, includeTest],
    queryFn: () => fn({ data: { role, days, date, includeTest } }),
  });

  const rows = data?.rows ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <Link
        to="/admin/reporting"
        search={{ test: includeTest }}
        className="text-sm text-accent-ink underline-offset-4 hover:underline"
      >
        ← Back to reporting
      </Link>

      <header className="space-y-1">
        <Eyebrow size="small" tone="accent-ink">
          Admin
        </Eyebrow>
        <h1 className="font-display text-h1 text-text-primary">Active users</h1>
        <p className="text-sm text-text-secondary">
          {ROLE_LABEL[role]} ·{" "}
          {date ? new Date(`${date}T00:00:00Z`).toLocaleDateString() : `Last ${days} days`} ·{" "}
          {rows.length} user{rows.length === 1 ? "" : "s"}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "coaches", "parents", "athletes"] as const).map((r) => (
          <Link
            key={r}
            from={Route.fullPath}
            search={(prev: any) => ({ ...prev, role: r })}
            className={chipClasses({ tone: "muted", weight: "medium", selected: role === r })}
          >
            {ROLE_LABEL[r]}
          </Link>
        ))}
        {!date &&
          [7, 30].map((d) => (
            <Link
              key={d}
              from={Route.fullPath}
              search={(prev: any) => ({ ...prev, days: d })}
              className={chipClasses({ tone: "muted", weight: "medium", selected: days === d })}
            >
              {d}d
            </Link>
          ))}
        {date && (
          <Link
            from={Route.fullPath}
            search={(prev: any) => ({ ...prev, date: undefined })}
            className={chipClasses({ tone: "muted", weight: "medium" })}
          >
            Clear day filter
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-divider bg-card">
        {isLoading ? (
          <p className="p-4 text-sm text-text-secondary">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-text-secondary">No activity in this window.</p>
        ) : (
          <ul className="divide-y divide-divider">
            {rows.map((r) => (
              <li key={r.userId}>
                <Link
                  to="/admin/users/$userId"
                  params={{ userId: r.userId }}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-elevated"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-primary">
                      {r.name}
                      {r.isTest && <Tag className="ml-2">test</Tag>}
                    </p>
                    <p className="truncate text-xs text-text-secondary">{r.email ?? r.role}</p>
                    <p className="truncate text-[11px] text-text-tertiary">
                      {r.activities.join(" · ")}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-mono uppercase text-accent-ink">{r.role}</p>
                    <p className="text-xs text-text-tertiary">
                      {new Date(r.lastActiveAt).toLocaleString()}
                    </p>
                    <p className="text-[11px] text-text-tertiary">{r.eventCount} events</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-center pt-2">
        <Link
          from={Route.fullPath}
          search={(prev: any) => ({ ...prev, test: !includeTest })}
          className={chipClasses({ tone: "muted", weight: "medium", selected: includeTest })}
        >
          {includeTest ? "Test users: on" : "Test users: hidden"}
        </Link>
      </div>
    </div>
  );
}
