import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getAdminPlanDetail } from "@/lib/admin.functions";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import { stateLabel } from "@/lib/session-states";

export const Route = createFileRoute("/_authenticated/admin/plans/$planId")({
  component: AdminPlanDetail,
});

function AdminPlanDetail() {
  const { planId } = Route.useParams();
  const fn = useServerFn(getAdminPlanDetail);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-plan", planId],
    queryFn: () => fn({ data: { planId } }),
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <Link
        to="/admin/list/$kind"
        params={{ kind: "plans" }}
        search={{ filter: "all", test: false }}
        className="text-sm text-accent-ink underline-offset-4 hover:underline"
      >
        ← Back to plans
      </Link>

      {isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : error || !data ? (
        <p className="text-sm text-destructive">Could not load this plan.</p>
      ) : (
        <>
          <header className="space-y-1">
            <Eyebrow size="small" tone="accent-ink">{data.plan.kind}</Eyebrow>
            <h1 className="font-display text-h1 text-text-primary">
              {data.plan.title || "Untitled plan"}
            </h1>
            <p className="text-sm text-text-secondary">
              {data.plan.athleteName ?? "No athlete"} · Coach {data.plan.coachName ?? "—"}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Tag>{data.plan.status}</Tag>
              {data.plan.shared && <Tag>shared</Tag>}
              <span className="text-xs text-text-tertiary">
                Created {new Date(data.plan.createdAt).toLocaleDateString()} · Updated{" "}
                {new Date(data.plan.updatedAt).toLocaleDateString()}
              </span>
            </div>
          </header>

          {data.plan.notes && (
            <section className="rounded-xl border border-divider bg-card p-4">
              <h2 className="font-display text-h3 text-text-primary">Notes</h2>
              <p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">
                {data.plan.notes}
              </p>
            </section>
          )}

          <section className="rounded-xl border border-divider bg-card">
            <div className="border-b border-divider px-4 py-3">
              <h2 className="font-display text-h3 text-text-primary">
                Moves ({data.moves.length})
              </h2>
            </div>
            {data.moves.length === 0 ? (
              <p className="p-4 text-sm text-text-secondary">No moves on this plan.</p>
            ) : (
              <ul className="divide-y divide-divider">
                {data.moves.map((m: any) => (
                  <li key={m.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-semibold text-text-primary">
                        {m.position + 1}. {m.name}
                      </p>
                      <p className="shrink-0 text-xs font-mono text-accent-ink">
                        {m.target_value} {m.target_kind}
                      </p>
                    </div>
                    {m.cue && <p className="text-xs text-text-secondary">Cue: {m.cue}</p>}
                    {m.why && <p className="text-xs text-text-tertiary">Why: {m.why}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-divider bg-card">
            <div className="border-b border-divider px-4 py-3">
              <h2 className="font-display text-h3 text-text-primary">
                Sessions ({data.sessions.length})
              </h2>
              <p className="text-xs text-text-secondary">
                Every logged session for this plan, newest first.
              </p>
            </div>
            {data.sessions.length === 0 ? (
              <p className="p-4 text-sm text-text-secondary">No sessions logged yet.</p>
            ) : (
              <ul className="divide-y divide-divider">
                {data.sessions.map((s) => (
                  <li key={s.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-semibold text-text-primary">
                        {stateLabel(s.stateIndex)}
                      </p>
                      <p className="shrink-0 text-xs text-text-tertiary">
                        {new Date(s.loggedAt).toLocaleString()}
                      </p>
                    </div>
                    <p className="text-[11px] text-text-tertiary">
                      {Math.round(s.durationSeconds / 60)}m · logged by {s.loggedBy}
                    </p>
                    {s.note && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">
                        {s.note}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
