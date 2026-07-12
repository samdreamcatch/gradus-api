import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { FlowStateBars, type SessionsByState } from "./flow-state-bars";

interface PlanCardProps {
  to: "/parent/plans/$planId" | "/coach/plans/$planId" | "/athlete/plans/$planId";
  planId: string;
  title: string;
  athleteName?: string | null;
  sessionsByState: SessionsByState;
  sessionsTotal: number;
  muted?: boolean;
  caption?: string;
  edgeTone?: "active" | "template" | "muted";
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
  edgeTone = "active",
}: PlanCardProps) {
  return (
    <Link
      to={to}
      params={{ planId }}
      className={cn(
        "group relative block overflow-hidden rounded-2xl border border-divider bg-card p-4 pl-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-page",
        muted && "opacity-70",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-1.5",
          edgeTone === "active" || edgeTone === "template"
            ? "bg-[var(--flow-accent)]"
            : "bg-[var(--divider)]",
        )}
      />


      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          {athleteName ? (
            <p className="truncate text-xs font-medium text-text-secondary">
              {athleteName}
            </p>
          ) : caption ? (
            <p className="text-micro font-black uppercase tracking-widest text-text-tertiary">
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

    </Link>
  );
}

