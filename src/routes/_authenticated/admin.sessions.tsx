import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { getAdminSessions } from "@/lib/admin.functions";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import { chipClasses } from "@/components/ui/chip";
import { stateLabel } from "@/lib/session-states";

const searchSchema = z.object({
  days: fallback(z.number(), 7).default(7),
  test: fallback(z.boolean(), false).default(false),
});

export const Route = createFileRoute("/_authenticated/admin/sessions")({
  validateSearch: zodValidator(searchSchema),
  component: AdminSessions,
});

function AdminSessions() {
  const { days, test: includeTest } = Route.useSearch();
  const fn = useServerFn(getAdminSessions);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-sessions", days, includeTest],
    queryFn: () => fn({ data: { days, includeTest } }),
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
        <h1 className="font-display text-h1 text-text-primary">Logged sessions</h1>
        <p className="text-sm text-text-secondary">
          Last {days} days · {rows.length} session{rows.length === 1 ? "" : "s"}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {[7, 30, 90].map((d) => (
          <Link
            key={d}
            from={Route.fullPath}
            search={(prev: any) => ({ ...prev, days: d })}
            className={chipClasses({ tone: "muted", weight: "medium", selected: days === d })}
          >
            {d}d
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-divider bg-card">
        {isLoading ? (
          <p className="p-4 text-sm text-text-secondary">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-text-secondary">No sessions logged in this window.</p>
        ) : (
          <ul className="divide-y divide-divider">
            {rows.map((s) => (
              <li key={s.id}>
                <Link
                  to="/admin/plans/$planId"
                  params={{ planId: s.planId }}
                  className="block px-4 py-3 hover:bg-elevated"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text-primary">
                        {s.athleteName}
                        {s.isTest && <Tag className="ml-2">test</Tag>}
                      </p>
                      <p className="truncate text-xs text-text-secondary">{s.planTitle}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-mono uppercase text-accent-ink">
                        {stateLabel(s.stateIndex)}
                      </p>
                      <p className="text-xs text-text-tertiary">
                        {new Date(s.loggedAt).toLocaleString()}
                      </p>
                      <p className="text-[11px] text-text-tertiary">
                        {Math.round(s.durationSeconds / 60)}m · {s.loggedBy}
                      </p>
                    </div>
                  </div>
                  {s.note && (
                    <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{s.note}</p>
                  )}
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
