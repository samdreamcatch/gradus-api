import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AttentionItem as Item, ReadinessStatus } from "@/lib/trust-center";

const STATUS: Record<ReadinessStatus, { label: string; cls: string }> = {
  ready: { label: "Ready", cls: "border-accent/40 bg-accent/10 text-accent-ink" },
  attention: {
    label: "Needs attention",
    cls: "border-pen-orange/50 bg-pen-orange-wash text-pen-orange-ink",
  },
  blocked: { label: "Blocked", cls: "border-pen-pink/50 bg-pen-pink-wash text-pen-pink-ink" },
};

export function StatusTag({ status, className }: { status: ReadinessStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-xs font-medium",
        s.cls,
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

export function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-divider bg-card p-4 shadow-card">
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="mt-1 font-mono text-2xl text-text-primary">{value}</p>
      {note ? <p className="font-hand text-lg leading-tight text-text-secondary">{note}</p> : null}
    </div>
  );
}

export function AttentionRow({ item }: { item: Item }) {
  return (
    <Link
      to={item.to as never}
      search={item.search as never}
      className="press flex items-center gap-4 rounded-lg border border-divider bg-card px-4 py-3"
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-md font-mono text-sm",
          item.severity === "blocked"
            ? "bg-pen-pink-wash text-pen-pink-ink"
            : "bg-pen-orange-wash text-pen-orange-ink",
        )}
      >
        {item.count}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text-primary">{item.title}</span>
        <span className="block text-meta text-text-secondary">{item.reason}</span>
      </span>
      <span className="inline-flex items-center gap-1 text-xs text-accent-ink">
        Fix <ChevronRight className="size-3.5" />
      </span>
    </Link>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-caption uppercase tracking-wide text-text-tertiary">{children}</p>;
}
