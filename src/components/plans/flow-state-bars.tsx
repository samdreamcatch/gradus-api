import { cn } from "@/lib/utils";

export interface SessionsByState {
  frustrated: number;
  pushing: number;
  steady: number;
  lockedIn: number;
  flowing: number;
}

/** Collapse 5-point scale → 3 buckets and produce integer percentages summing to 100. */
export function bucketPercents(counts: SessionsByState) {
  const frustrated = counts.frustrated;
  const control = counts.pushing + counts.steady + counts.lockedIn;
  const flow = counts.flowing;
  const total = frustrated + control + flow;
  if (total === 0) {
    return { frustrated: 0, control: 0, flow: 0, total: 0 };
  }
  const raw = [
    { key: "frustrated" as const, v: (frustrated / total) * 100 },
    { key: "control" as const, v: (control / total) * 100 },
    { key: "flow" as const, v: (flow / total) * 100 },
  ];
  const floored = raw.map((r) => ({ ...r, f: Math.floor(r.v), rem: r.v - Math.floor(r.v) }));
  let remainder = 100 - floored.reduce((s, r) => s + r.f, 0);
  floored.sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < floored.length && remainder > 0; i++, remainder--) {
    floored[i].f += 1;
  }
  const map = Object.fromEntries(floored.map((r) => [r.key, r.f])) as Record<
    "frustrated" | "control" | "flow",
    number
  >;
  return { frustrated: map.frustrated, control: map.control, flow: map.flow, total };
}

type BucketKey = "frustrated" | "control" | "flow";

const bucketMeta: Record<BucketKey, { label: string; fill: string; ink: string }> = {
  frustrated: {
    label: "Frustrated",
    // Neutral muted — friction, not alarm.
    fill: "bg-text-tertiary",
    ink: "text-text-secondary",
  },
  control: {
    // Pen accent — the user's selected pen color.
    label: "Control",
    fill: "bg-accent",
    ink: "text-accent-ink",
  },
  flow: {
    // Pen wash — same hue, lighter.
    label: "Flow",
    fill: "bg-accent/30",
    ink: "text-accent-ink",
  },
};

const PILL_SHADOW = "inset 0 -3px 0 rgba(0,0,0,0.18)";

export function FlowStateBars({ counts }: { counts: SessionsByState }) {
  const pct = bucketPercents(counts);
  const empty = pct.total === 0;
  const order: BucketKey[] = ["frustrated", "control", "flow"];

  return (
    <div className="grid grid-cols-3 gap-2">
      {order.map((k) => {
        const meta = bucketMeta[k];
        const value = empty ? 0 : pct[k];
        return (
          <div key={k} className="flex min-w-0 flex-col gap-1.5">
            {/* Cup: equal-width track, fill grows left→right by % */}
            <div className="relative h-5 w-full overflow-hidden rounded-full bg-divider/60">
              <div
                className={cn("h-full rounded-full transition-[width]", meta.fill)}
                style={{ width: `${value}%`, boxShadow: value > 0 ? PILL_SHADOW : undefined }}
              />
            </div>
            <div className="flex items-baseline justify-between gap-2 px-0.5">
              <span
                className={cn(
                  "truncate text-[10px] font-black uppercase tracking-widest",
                  meta.ink,
                )}
              >
                {meta.label}
              </span>
              <span className={cn("text-xs font-bold tabular-nums", meta.ink)}>
                {empty ? "—" : `${value}%`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
