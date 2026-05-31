import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { FlowStateBars, type SessionsByState } from "./flow-state-bars";

interface PlanCardProps {
  to: "/parent/plans/$planId" | "/coach/plans/$planId";
  planId: string;
  title: string;
  athleteName?: string | null;
  sessionsByState: SessionsByState;
  sessionsTotal: number;
  muted?: boolean;
  caption?: string;
}

export function PlanCard({
  to,
  planId,
  title,
  athleteName,
  sessionsByState,
  sessionsTotal,
  muted,
  caption,
}: PlanCardProps) {
  return (
    <Link
      to={to}
      params={{ planId }}
      className={cn(
        "group block rounded-2xl border border-divider bg-card p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-page",
        muted && "opacity-70",
      )}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          {athleteName ? (
            <p className="truncate text-xs font-medium text-text-secondary">
              {athleteName}
            </p>
          ) : caption ? (
            <p className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
              {caption}
            </p>
          ) : null}
          <h3 className="truncate font-display text-lg font-black leading-tight tracking-tight text-text-primary">
            {title || "Untitled plan"}
          </h3>
        </div>
        <span className="shrink-0 text-xs text-text-tertiary tabular-nums">
          {sessionsTotal === 0
            ? "0 sessions"
            : `${sessionsTotal} session${sessionsTotal === 1 ? "" : "s"}`}
        </span>
      </div>

      <FlowStateBars counts={sessionsByState} />
      {sessionsTotal === 0 ? (
        <p className="mt-2 font-hand text-base text-text-tertiary">
          No sessions logged yet
        </p>
      ) : null}
    </Link>
  );
}
