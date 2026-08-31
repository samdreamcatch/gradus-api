import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { adminListReports, adminUpdateReportStatus } from "@/lib/safety.functions";
import { REPORT_REASON_LABELS, REPORT_STATUS_LABELS, type ReportStatus } from "@/lib/safety-types";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Chip, chipClasses } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  open: fallback(z.boolean(), false).default(false),
});

const STATUSES: ReportStatus[] = ["open", "reviewed", "actioned", "dismissed"];

export const Route = createFileRoute("/_authenticated/admin/reports")({
  validateSearch: zodValidator(searchSchema),
  component: AdminReports,
});

function AdminReports() {
  const { open } = Route.useSearch();
  const listFn = useServerFn(adminListReports);
  const updateFn = useServerFn(adminUpdateReportStatus);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-reports", open],
    queryFn: () => listFn({ data: { openOnly: open } }),
  });

  const setStatus = useMutation({
    mutationFn: updateFn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-reports"] }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <header className="space-y-3">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="size-3.5" /> Back to admin
        </Link>
        <div>
          <Eyebrow size="small" tone="accent-ink">
            Trust &amp; safety
          </Eyebrow>
          <h1 className="font-display text-h1 text-text-primary">Reports</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            from={Route.fullPath}
            search={(prev: any) => ({ ...prev, open: !open })}
            className={chipClasses({ tone: "muted", selected: open })}
          >
            {open ? "Open only" : "All statuses"}
          </Link>
        </div>
      </header>

      {isLoading ? (
        <p className="text-text-secondary">Loading…</p>
      ) : !data?.items.length ? (
        <p className="text-text-secondary">No reports.</p>
      ) : (
        <ul className="space-y-3">
          {data.items.map((r) => (
            <li
              key={r.id}
              className={cn(
                "rounded-lg border bg-card p-4 shadow-card",
                r.urgent ? "border-destructive/60" : "border-divider",
                r.status !== "open" && "opacity-75",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {r.urgent ? <ShieldAlert className="size-4 text-destructive" /> : null}
                  <span className="text-xs font-semibold text-text-primary">
                    {REPORT_REASON_LABELS[r.reason]}
                  </span>
                </div>
                <span className="text-[11px] text-text-tertiary">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>

              <p className="mt-2 text-sm text-text-primary">
                <strong>{r.reported.name}</strong>{" "}
                <span className="text-text-tertiary">({r.reported.role})</span> reported by{" "}
                <strong>{r.reporter.name}</strong>{" "}
                <span className="text-text-tertiary">({r.reporter.role})</span>
              </p>

              {r.note ? (
                <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-text-primary">
                  {r.note}
                </p>
              ) : null}

              {r.messageBody ? (
                <p className="mt-2 rounded-md border border-divider bg-elevated/60 p-2 text-sm text-text-secondary">
                  {r.messageBody}
                </p>
              ) : null}

              {r.resourceTitle ? (
                <p className="mt-2 rounded-md border border-divider bg-elevated/60 p-2 text-sm text-text-secondary">
                  Resource: {r.resourceTitle}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {STATUSES.map((s) => (
                  <Chip
                    key={s}
                    size="caption"
                    tone="muted"
                    selected={r.status === s}
                    onClick={() => setStatus.mutate({ data: { id: r.id, status: s } })}
                  >
                    {REPORT_STATUS_LABELS[s]}
                  </Chip>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
