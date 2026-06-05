import { cn } from "@/lib/utils";

export type GoalStatus = "building" | "onTrack" | "behind" | "over" | "unset";

const STATUS_LABEL: Record<GoalStatus, string> = {
  building: "Building up",
  onTrack: "On track",
  behind: "Behind",
  over: "Over target",
  unset: "Not yet set",
};

const STATUS_CLASS: Record<GoalStatus, string> = {
  building: "bg-secondary-accent-wash text-secondary-accent-ink",
  onTrack: "bg-accent/15 text-accent-ink",
  behind: "bg-attention-wash text-attention-ink",
  over: "bg-destructive/15 text-destructive",
  unset: "bg-muted text-text-secondary",
};

export function StatusPill({ status, className }: { status: GoalStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
        STATUS_CLASS[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
