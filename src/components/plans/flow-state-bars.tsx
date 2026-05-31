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

export function FlowStateBars({ counts }: { counts: SessionsByState }) {
  const pct = bucketPercents(counts);
  const total = pct.total;

  const segments = [
    {
      key: "frustrated" as const,
      label: "Frustrated",
      pct: pct.frustrated,
      fill: "var(--pen-pool-ink)",
      labelColor: "var(--text-tertiary)",
    },
    {
      key: "control" as const,
      label: "In Control",
      pct: pct.control,
      fill: "linear-gradient(to right, var(--pen-pool-ink), var(--pen-tennis))",
      labelColor: "var(--text-secondary)",
    },
    {
      key: "flow" as const,
      label: "Flowing",
      pct: pct.flow,
      fill: "linear-gradient(to top, color-mix(in oklab, var(--accent) 25%, transparent) 0%, color-mix(in oklab, var(--accent) 65%, transparent) 50%, var(--accent) 100%)",
      labelColor: "var(--accent-ink)",
    },
  ];

  return (
    <div>
      <div
        className="flex h-8 w-full items-end gap-1.5"
        role="img"
        aria-label="Share of sessions by emotional state"
      >
        {segments.map((seg) => {
          const value = total > 0 ? seg.pct : 0;
          const glow = seg.key === "flow";
          return (
            <div
              key={seg.key}
              className="relative flex h-full flex-1 items-end overflow-hidden"
              style={{ background: "color-mix(in oklab, var(--text-tertiary) 18%, transparent)" }}
              title={`${seg.label}: ${value}%`}
            >
              <div
                className="w-full transition-[height]"
                style={{
                  height: `${value}%`,
                  background: seg.fill,
                  boxShadow: glow && value > 0
                    ? "0 0 8px color-mix(in oklab, var(--accent) 40%, transparent)"
                    : undefined,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex w-full gap-1.5 text-[10px] uppercase tracking-wider">
        {segments.map((seg) => (
          <div key={seg.key} className="flex flex-1 items-baseline justify-center gap-1">
            <span style={{ color: seg.labelColor }}>{seg.label}</span>
            <span className="tabular-nums" style={{ color: seg.labelColor }}>
              {total > 0 ? `${seg.pct}%` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
