import { cn } from "@/lib/utils";

export type ClubStatus = "healthy" | "attention" | "critical" | "informational";
const tones: Record<ClubStatus, string> = {
  healthy: "bg-club-healthy",
  attention: "bg-attention",
  critical: "bg-destructive",
  informational: "bg-text-tertiary",
};
export function StatusDot({ status, label }: { status: ClubStatus; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-text-primary">
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", tones[status])} />
      {label}
    </span>
  );
}
export function ClubStatusLegend() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Status legend">
      <StatusDot status="healthy" label="Healthy or done" />
      <StatusDot status="attention" label="Needs attention" />
      <StatusDot status="critical" label="Critical or under review" />
      <StatusDot status="informational" label="Informational" />
    </div>
  );
}
