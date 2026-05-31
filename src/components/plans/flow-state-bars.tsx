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
    { key: "frustrated", v: (frustrated / total) * 100 },
    { key: "control", v: (control / total) * 100 },
    { key: "flow", v: (flow / total) * 100 },
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

const buckets = [
  {
    key: "frustrated" as const,
    label: "Frustrated",
    track: "bg-[var(--pen-orange-wash)]",
    fill: "bg-[var(--pen-orange)]",
    ink: "text-[var(--pen-orange-ink)]",
  },
  {
    key: "control" as const,
    label: "Control",
    track: "bg-[var(--pen-pool-wash)]",
    fill: "bg-[var(--pen-pool)]",
    ink: "text-[var(--pen-pool-ink)]",
  },
  {
    key: "flow" as const,
    label: "Flow",
    track: "bg-[var(--pen-tennis-wash)]",
    fill: "bg-[var(--pen-tennis)]",
    ink: "text-[var(--pen-tennis-ink)]",
  },
];

export function FlowStateBars({ counts }: { counts: SessionsByState }) {
  const pct = bucketPercents(counts);
  const empty = pct.total === 0;

  return (
    <div className="grid grid-cols-3 gap-2">
      {buckets.map((b) => {
        const value = empty ? 0 : pct[b.key];
        return (
          <div key={b.key} className="flex flex-col gap-1">
            <div className={cn("h-2 w-full overflow-hidden rounded-full", b.track)}>
              <div
                className={cn("h-full rounded-full transition-[width]", b.fill)}
                style={{ width: `${value}%` }}
              />
            </div>
            <div className="flex items-baseline justify-between gap-1">
              <span className={cn("text-[10px] font-black uppercase tracking-widest", b.ink)}>
                {b.label}
              </span>
              <span className={cn("text-xs font-bold tabular-nums", b.ink)}>
                {empty ? "—" : `${value}%`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
