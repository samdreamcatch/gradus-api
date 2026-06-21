import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Bug, Lightbulb, Heart, MoreHorizontal, Check, ArrowLeft } from "lucide-react";
import { listFeedback, setFeedbackResolved } from "@/lib/feedback.functions";
import { cn } from "@/lib/utils";

const TYPE_META: Record<string, { label: string; icon: typeof Bug }> = {
  bug: { label: "Bug", icon: Bug },
  idea: { label: "Idea", icon: Lightbulb },
  praise: { label: "Praise", icon: Heart },
  other: { label: "Other", icon: MoreHorizontal },
};

const searchSchema = z.object({
  type: fallback(z.enum(["all", "bug", "idea", "praise", "other"]), "all").default("all"),
  unresolved: fallback(z.boolean(), false).default(false),
});

export const Route = createFileRoute("/_authenticated/admin/feedback")({
  validateSearch: zodValidator(searchSchema),
  component: AdminFeedback,
});

function AdminFeedback() {
  const { type, unresolved } = Route.useSearch();
  const listFn = useServerFn(listFeedback);
  const resolveFn = useServerFn(setFeedbackResolved);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-feedback", type, unresolved],
    queryFn: () => listFn({ data: { type, unresolvedOnly: unresolved } }),
  });

  const toggle = useMutation({
    mutationFn: resolveFn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-feedback"] }),
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
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">Internal</p>
          <h1 className="font-display text-h1 text-text-primary">Feedback</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", "bug", "idea", "praise", "other"] as const).map((t) => {
            const active = type === t;
            return (
              <Link
                key={t}
                from={Route.fullPath}
                search={(prev) => ({ ...prev, type: t })}
                className={cn(
                  "rounded-pill border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition",
                  active
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-divider bg-card text-text-secondary hover:bg-elevated",
                )}
              >
                {t === "all" ? "All" : TYPE_META[t].label}
              </Link>
            );
          })}
          <Link
            from={Route.fullPath}
            search={(prev) => ({ ...prev, unresolved: !unresolved })}
            className={cn(
              "rounded-pill border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition",
              unresolved
                ? "border-accent bg-accent text-accent-foreground"
                : "border-divider bg-card text-text-secondary hover:bg-elevated",
            )}
          >
            {unresolved ? "Unresolved only" : "All statuses"}
          </Link>
        </div>
      </header>

      {isLoading ? (
        <p className="text-text-secondary">Loading…</p>
      ) : !data?.items.length ? (
        <p className="text-text-secondary">No feedback yet.</p>
      ) : (
        <ul className="space-y-3">
          {data.items.map((f: any) => {
            const meta = TYPE_META[f.type] ?? TYPE_META.other;
            const Icon = meta.icon;
            const resolved = !!f.resolved_at;
            return (
              <li
                key={f.id}
                className={cn(
                  "rounded-lg border bg-card p-4 shadow-card",
                  resolved ? "border-divider opacity-70" : "border-divider",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-pill border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-accent-ink">
                      <Icon className="size-3" /> {meta.label}
                    </span>
                    <span className="text-xs font-semibold text-text-primary">{f.name}</span>
                    <span className="text-[11px] uppercase tracking-wider text-text-tertiary">
                      {f.role}
                    </span>
                    {f.isTest && (
                      <span className="rounded border border-divider px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-tertiary">
                        test
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-text-tertiary">
                      {new Date(f.created_at).toLocaleString()}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        toggle.mutate({ data: { id: f.id, resolved: !resolved } })
                      }
                      className={cn(
                        "inline-flex items-center gap-1 rounded-pill border px-2 py-1 text-[11px] font-bold uppercase tracking-wider transition",
                        resolved
                          ? "border-accent bg-accent text-accent-foreground"
                          : "border-divider bg-card text-text-secondary hover:bg-elevated",
                      )}
                    >
                      <Check className="size-3" />
                      {resolved ? "Resolved" : "Mark resolved"}
                    </button>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-text-primary">
                  {f.message}
                </p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-tertiary">
                  {f.path && <span className="font-mono">{f.path}</span>}
                  {f.viewport && <span>{f.viewport}</span>}
                  {f.user_agent && (
                    <span className="truncate max-w-full" title={f.user_agent}>
                      {f.user_agent}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
