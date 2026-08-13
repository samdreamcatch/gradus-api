import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { getEmailHealth } from "@/lib/email-health.functions";
import { Eyebrow } from "@/components/ui/eyebrow";
import { chipClasses } from "@/components/ui/chip";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

const RANGES = [
  { key: "24h", label: "Last 24h", hours: 24 },
  { key: "7d", label: "7 days", hours: 24 * 7 },
  { key: "30d", label: "30 days", hours: 24 * 30 },
] as const;

const STATUS_FILTERS = [
  { key: "", label: "All statuses" },
  { key: "sent", label: "Sent" },
  { key: "dlq", label: "Failed" },
  { key: "suppressed", label: "Suppressed" },
  { key: "pending", label: "Pending" },
] as const;

const searchSchema = z.object({
  range: fallback(z.enum(["24h", "7d", "30d", "custom"]), "7d").default("7d"),
  from: fallback(z.string(), "").default(""),
  to: fallback(z.string(), "").default(""),
  template: fallback(z.string(), "").default(""),
  status: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/admin/email-health")({
  validateSearch: zodValidator(searchSchema),
  component: AdminEmailHealth,
});

function statusTone(status: string) {
  if (status === "sent") return "border-pen-tennis/40 bg-pen-tennis-wash text-pen-tennis-ink";
  if (status === "dlq" || status === "failed" || status === "bounced")
    return "border-pen-pink/40 bg-pen-pink-wash text-pen-pink-ink";
  if (status === "suppressed" || status === "complained")
    return "border-pen-orange/40 bg-pen-orange-wash text-pen-orange-ink";
  return "border-divider bg-elevated text-text-tertiary";
}

function resolveWindow(search: z.infer<typeof searchSchema>) {
  if (search.range === "custom" && search.from && search.to) {
    return {
      start: new Date(`${search.from}T00:00:00.000Z`).toISOString(),
      end: new Date(`${search.to}T23:59:59.999Z`).toISOString(),
    };
  }
  const hours = RANGES.find((r) => r.key === search.range)?.hours ?? 24 * 7;
  return {
    start: new Date(Date.now() - hours * 3600_000).toISOString(),
    end: new Date(Date.now() + 60_000).toISOString(),
  };
}

function AdminEmailHealth() {
  const search = Route.useSearch();
  const fetchFn = useServerFn(getEmailHealth);
  const { start, end } = resolveWindow(search);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-email-health", start, end, search.template, search.status],
    queryFn: () =>
      fetchFn({
        data: {
          start,
          end,
          template: search.template || null,
          status: search.status || null,
        },
      }),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <header className="space-y-3">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-text-secondary"
        >
          <ArrowLeft className="size-3.5" /> Back to admin
        </Link>
        <div>
          <Eyebrow size="small" tone="accent-ink">
            Internal
          </Eyebrow>
          <h1 className="font-display text-h1 text-text-primary">Email deliverability</h1>
          <p className="text-text-secondary text-sm mt-1">
            Every email the app has sent — one row per email, showing its latest state. Contains
            recipient addresses; admin-only.
          </p>
        </div>
      </header>

      {/* Time range */}
      <div className="space-y-2">
        <p className="text-caption uppercase tracking-widest text-text-tertiary">Time range</p>
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <Link
              key={r.key}
              from={Route.fullPath}
              search={(prev: any) => ({ ...prev, range: r.key })}
              className={chipClasses({ tone: "muted", selected: search.range === r.key })}
            >
              {r.label}
            </Link>
          ))}
          <Link
            from={Route.fullPath}
            search={(prev: any) => ({ ...prev, range: "custom" })}
            className={chipClasses({ tone: "muted", selected: search.range === "custom" })}
          >
            Custom
          </Link>
          {search.range === "custom" && (
            <span className="flex flex-wrap items-center gap-2">
              <DateInput field="from" value={search.from} />
              <span className="text-text-tertiary text-xs">to</span>
              <DateInput field="to" value={search.to} />
            </span>
          )}
        </div>
      </div>

      {/* Template + status */}
      <div className="flex flex-wrap items-end gap-4">
        <label className="space-y-1">
          <span className="block text-caption uppercase tracking-widest text-text-tertiary">
            Email type
          </span>
          <TemplateSelect templates={data?.templates ?? []} value={search.template} />
        </label>
        <div className="space-y-2">
          <span className="block text-caption uppercase tracking-widest text-text-tertiary">
            Status
          </span>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((s) => (
              <Link
                key={s.key || "all"}
                from={Route.fullPath}
                search={(prev: any) => ({ ...prev, status: s.key })}
                className={chipClasses({ tone: "muted", selected: search.status === s.key })}
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Emails" value={data?.counts.total} loading={isLoading} />
        <StatCard label="Sent" value={data?.counts.sent} loading={isLoading} />
        <StatCard label="Failed" value={data?.counts.failed} loading={isLoading} />
        <StatCard label="Suppressed" value={data?.counts.suppressed} loading={isLoading} />
      </div>

      {/* Log */}
      {isLoading ? (
        <p className="text-text-secondary">Loading…</p>
      ) : !data?.rows.length ? (
        <p className="text-text-secondary">No emails in this window.</p>
      ) : (
        <ul className="space-y-2">
          {data.rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-divider bg-card p-3 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display text-text-primary truncate">{r.templateName}</p>
                  <p className="text-meta text-text-secondary truncate">{r.recipientEmail}</p>
                </div>
                <div className="flex items-center gap-2">
                  {r.attempts > 1 && (
                    <Tag size="micro" tone="muted">
                      {r.attempts} attempts
                    </Tag>
                  )}
                  <span
                    className={cn(
                      "rounded-pill border px-2 py-0.5 text-micro font-mono uppercase",
                      statusTone(r.status),
                    )}
                  >
                    {r.status}
                  </span>
                  <span className="text-mono text-text-tertiary">
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
              {r.errorMessage && (
                <p className="mt-2 text-meta text-pen-pink-ink break-words">{r.errorMessage}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {data?.truncated && (
        <p className="text-xs text-text-tertiary">
          Showing the 500 most recent emails in this window — narrow the range to see more.
        </p>
      )}

      {/* Suppressions */}
      {!!data?.suppressed.length && (
        <section className="space-y-2 pt-4">
          <h2 className="font-display text-h3 text-text-primary">Suppressed addresses</h2>
          <p className="text-meta text-text-secondary">
            Bounced, complained, or unsubscribed. App emails skip these automatically.
          </p>
          <ul className="rounded-lg border border-divider bg-card divide-y divide-divider shadow-card">
            {data.suppressed.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="text-meta text-text-primary truncate">{s.email}</span>
                <span className="flex items-center gap-2">
                  <Tag size="micro" tone="muted">
                    {s.reason}
                  </Tag>
                  <span className="text-mono text-text-tertiary">
                    {new Date(s.created_at).toLocaleDateString()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
}) {
  return (
    <div className="rounded-lg border border-divider bg-card p-3 shadow-card">
      <p className="text-caption uppercase tracking-widest text-text-tertiary">{label}</p>
      <p className="font-display text-h2 text-text-primary">{loading ? "—" : (value ?? 0)}</p>
    </div>
  );
}

function DateInput({ field, value }: { field: "from" | "to"; value: string }) {
  const navigate = Route.useNavigate();
  return (
    <input
      type="date"
      value={value}
      onChange={(e) =>
        navigate({
          search: (prev: any) => ({ ...prev, range: "custom", [field]: e.target.value }),
        })
      }
      className="rounded-sm border border-divider bg-card px-2 py-1 text-meta text-text-primary"
    />
  );
}

function TemplateSelect({ templates, value }: { templates: string[]; value: string }) {
  const navigate = Route.useNavigate();
  return (
    <select
      value={value}
      onChange={(e) => navigate({ search: (prev: any) => ({ ...prev, template: e.target.value }) })}
      className="rounded-sm border border-divider bg-card px-2 py-1.5 text-meta text-text-primary"
    >
      <option value="">All types</option>
      {templates.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}
