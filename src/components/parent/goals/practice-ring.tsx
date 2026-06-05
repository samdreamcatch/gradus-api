import type { GoalStatus } from "./status-pill";

const TONE: Record<GoalStatus, string> = {
  building: "text-secondary-accent",
  onTrack: "text-accent",
  behind: "text-attention",
  over: "text-destructive",
  unset: "text-muted-foreground",
};

const STROKE_COLOR: Record<GoalStatus, string> = {
  building: "var(--secondary-accent)",
  onTrack: "var(--accent)",
  behind: "var(--attention)",
  over: "var(--destructive-ink)",
  unset: "var(--text-disabled)",
};

/** Waking hours per week, assuming 8 hours of sleep per night. */
export const WAKING_HOURS_PER_WEEK = 16 * 7;

interface Props {
  /** Hours logged this week (fill). */
  hours: number;
  /** Lower bound of expected target band (hr/wk). */
  targetLower: number | null;
  /** Upper bound of expected target band (hr/wk). */
  targetUpper: number | null;
  status: GoalStatus;
}

export function PracticeRing({ hours, targetLower, targetUpper, status }: Props) {
  const size = 96;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const c = 2 * Math.PI * r;
  const total = WAKING_HOURS_PER_WEEK;

  const fillPct = Math.max(0, Math.min(1, hours / total));
  const dash = c * fillPct;

  // Compute tick angles. Ring starts at 12 o'clock and goes clockwise.
  const toAngleDeg = (hrs: number) => -90 + (hrs / total) * 360;
  const tickPoint = (hrs: number, len: number) => {
    const a = (toAngleDeg(hrs) * Math.PI) / 180;
    const inner = r - stroke / 2 - 1;
    const outer = r + stroke / 2 + len;
    return {
      x1: cx + Math.cos(a) * inner,
      y1: cy + Math.sin(a) * inner,
      x2: cx + Math.cos(a) * outer,
      y2: cy + Math.sin(a) * outer,
    };
  };

  return (
    <svg
      width={size}
      height={size}
      className="shrink-0 overflow-visible"
      aria-label={`${hours.toFixed(1)} hours logged this week of ${total} waking hours`}
    >
      {/* Background ring */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        strokeWidth={stroke}
        stroke="var(--divider)"
      />
      {/* Filled arc — logged hours */}
      {fillPct > 0 && (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          className={TONE[status]}
          stroke={STROKE_COLOR[status]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      )}
      {/* Target band ticks */}
      {targetLower != null && (() => {
        const p = tickPoint(targetLower, 3);
        return (
          <line
            x1={p.x1}
            y1={p.y1}
            x2={p.x2}
            y2={p.y2}
            strokeWidth={2}
            strokeLinecap="round"
            stroke="var(--text-primary)"
          />
        );
      })()}
      {targetUpper != null && targetUpper !== targetLower && (() => {
        const p = tickPoint(targetUpper, 3);
        return (
          <line
            x1={p.x1}
            y1={p.y1}
            x2={p.x2}
            y2={p.y2}
            strokeWidth={2}
            strokeLinecap="round"
            stroke="var(--text-primary)"
          />
        );
      })()}
      <text
        x="50%"
        y="46%"
        textAnchor="middle"
        dominantBaseline="middle"
        className="text-[18px] font-bold"
        fill="var(--text-primary)"
      >
        {hours.toFixed(1)}
      </text>
      <text
        x="50%"
        y="64%"
        textAnchor="middle"
        dominantBaseline="middle"
        className="text-[9px] font-semibold uppercase tracking-wide"
        fill="var(--text-secondary)"
      >
        hr / wk
      </text>
    </svg>
  );
}
