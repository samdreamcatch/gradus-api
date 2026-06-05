import type { GoalStatus } from "./status-pill";

const TONE: Record<GoalStatus, string> = {
  building: "text-secondary-accent",
  onTrack: "text-accent",
  behind: "text-attention",
  over: "text-destructive",
  unset: "text-muted-foreground",
};

interface Props {
  hours: number;
  /** Upper bound used to scale the arc (defaults to 1 if unknown). */
  scaleMax: number;
  status: GoalStatus;
}

export function PracticeRing({ hours, scaleMax, status }: Props) {
  const size = 88;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = scaleMax > 0 ? Math.min(1, hours / scaleMax) : 0;
  const dash = c * pct;

  return (
    <svg width={size} height={size} className="shrink-0" aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        className="stroke-divider"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        className={TONE[status]}
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="46%"
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-text-primary text-[18px] font-bold"
      >
        {hours.toFixed(1)}
      </text>
      <text
        x="50%"
        y="64%"
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-text-secondary text-[9px] font-semibold uppercase tracking-wide"
      >
        hr / wk
      </text>
    </svg>
  );
}
