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

export function PracticeRing({ hours, targetUpper, status }: Props) {
  const size = 96;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const c = 2 * Math.PI * r;

  // Full ring = high end of target band. Fall back to waking hours if unset.
  const total = targetUpper && targetUpper > 0 ? targetUpper : WAKING_HOURS_PER_WEEK;
  const fillPct = Math.max(0, Math.min(1, hours / total));
  const dash = c * fillPct;
  const strokeColor = STROKE_COLOR[status];

  return (
    <svg
      width={size}
      height={size}
      className="shrink-0 overflow-visible"
      aria-label={`${hours.toFixed(1)} hours logged per week of ${total} target`}
    >
      {/* Background ring — light wash representing the high end of the target */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        strokeWidth={stroke}
        stroke={`color-mix(in oklab, ${strokeColor} 22%, transparent)`}
      />
      {/* Filled arc — actual hours logged */}
      {fillPct > 0 && (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          className={TONE[status]}
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      )}
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
