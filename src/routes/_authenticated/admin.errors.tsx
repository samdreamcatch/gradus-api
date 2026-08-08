import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useState } from "react";
import { ArrowLeft, Sparkles, Loader2 } from "lucide-react";
import { listAdminErrorGroups, explainErrorGroup } from "@/lib/error-tracking.functions";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Chip, chipClasses } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  test: fallback(z.boolean(), false).default(false),
});

export const Route = createFileRoute("/_authenticated/admin/errors")({
  validateSearch: zodValidator(searchSchema),
  component: AdminErrors,
});

function AdminErrors() {
  const { test: includeTest } = Route.useSearch();
  const listFn = useServerFn(listAdminErrorGroups);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-error-groups", includeTest],
    queryFn: () => listFn({ data: { limit: 1000, includeTest } }),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <header className="space-y-3">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="size-3.5" /> Back to admin
        </Link>
        <div>
          <Eyebrow size="small" tone="accent-ink">
            Internal
          </Eyebrow>
          <h1 className="font-display text-h1 text-text-primary">Errors</h1>
          <p className="text-text-secondary text-sm mt-1">
            Grouped by normalized message. Click <span className="italic">Explain</span> for an
            AI-written summary.
          </p>
          {data && (
            <p className="text-xs text-text-tertiary mt-1">
              {data.groups.length} group{data.groups.length === 1 ? "" : "s"} ·{" "}
              {data.totalOccurrences} occurrence{data.totalOccurrences === 1 ? "" : "s"}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            from={Route.fullPath}
            search={(prev: any) => ({ ...prev, test: !includeTest })}
            className={chipClasses({ tone: "muted", selected: includeTest })}
          >
            {includeTest ? "Test users: on" : "Test users: hidden"}
          </Link>
        </div>
      </header>

      {isLoading ? (
        <p className="text-text-secondary">Loading…</p>
      ) : !data?.groups.length ? (
        <p className="text-text-secondary">No errors recorded yet.</p>
      ) : (
        <ul className="space-y-3">
          {data.groups.map((g: any) => (
            <GroupCard key={g.signature} group={g} />
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupCard({ group }: { group: any }) {
  const explainFn = useServerFn(explainErrorGroup);
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [localExplanation, setLocalExplanation] = useState<string | null>(group.explanation);

  const explain = useMutation({
    mutationFn: () => explainFn({ data: { signature: group.signature } }),
    onSuccess: (res: any) => {
      setLocalExplanation(res.explanation);
      setExpanded(true);
      qc.invalidateQueries({ queryKey: ["admin-error-groups"] });
    },
  });

  return (
    <li className="rounded-lg border border-divider bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0",
              group.source === "server"
                ? "bg-pen-orange-wash text-pen-orange-ink"
                : "bg-pen-pool-wash text-pen-pool-ink",
            )}
          >
            {group.source}
          </span>
          <span className="text-sm font-semibold text-text-primary break-all">
            {group.sampleMessage}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-bold text-text-secondary">
            ×{group.count}
          </span>
          {group.uniqueUsers > 0 && (
            <span className="text-[11px] text-text-tertiary whitespace-nowrap">
              {group.uniqueUsers} user{group.uniqueUsers === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-tertiary">
        <span>Last: {new Date(group.lastSeen).toLocaleString()}</span>
        <span>First: {new Date(group.firstSeen).toLocaleString()}</span>
        {group.routes.length > 0 && (
          <span className="font-mono truncate">
            {group.routes.slice(0, 3).join(" · ")}
            {group.routes.length > 3 ? ` +${group.routes.length - 3}` : ""}
          </span>
        )}
      </div>

      {(group.users?.length > 0 || group.anonCount > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {group.users?.slice(0, 8).map((u: any) => {
            const label = u.name || u.email || u.userId.slice(0, 8);
            const title = [u.email, u.role, `${u.count}×`].filter(Boolean).join(" · ");
            return (
              <span
                key={u.userId}
                title={title}
                className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[11px] text-text-secondary"
              >
                <span className="truncate max-w-[160px]">{label}</span>
                {u.role && (
                  <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
                    {u.role}
                  </span>
                )}
                {u.count > 1 && (
                  <span className="text-[10px] font-bold text-text-tertiary">×{u.count}</span>
                )}
              </span>
            );
          })}
          {group.users?.length > 8 && (
            <span className="inline-flex items-center rounded-full bg-elevated px-2 py-0.5 text-[11px] text-text-tertiary">
              +{group.users.length - 8} more
            </span>
          )}
          {group.anonCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-elevated px-2 py-0.5 text-[11px] text-text-tertiary">
              {group.anonCount} anon
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Chip
          as="button"
          tone="muted"
          size="micro"
          onClick={() => {
            if (localExplanation) {
              setExpanded((v) => !v);
            } else {
              explain.mutate();
            }
          }}
          disabled={explain.isPending}
        >
          {explain.isPending ? (
            <>
              <Loader2 className="size-3 animate-spin mr-1 inline" />
              Explaining…
            </>
          ) : localExplanation ? (
            expanded ? (
              "Hide explanation"
            ) : (
              "Show explanation"
            )
          ) : (
            <>
              <Sparkles className="size-3 mr-1 inline" />
              Explain
            </>
          )}
        </Chip>
        {localExplanation && (
          <Chip
            as="button"
            tone="muted"
            size="micro"
            onClick={() => explain.mutate()}
            disabled={explain.isPending}
            title="Regenerate explanation"
          >
            Regenerate
          </Chip>
        )}
        <Link
          to="/admin/errors/$id"
          params={{ id: group.latestId }}
          className="text-[11px] text-accent-ink underline-offset-4 hover:underline"
        >
          View latest occurrence →
        </Link>
      </div>

      {explain.error && (
        <p className="mt-2 text-xs text-destructive">{(explain.error as Error).message}</p>
      )}

      {localExplanation && expanded && (
        <div className="mt-3 rounded-lg border border-divider bg-elevated p-3">
          <Eyebrow size="small" tone="accent-ink" className="mb-1">
            AI explanation
          </Eyebrow>
          <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
            {localExplanation}
          </p>
        </div>
      )}
    </li>
  );
}
