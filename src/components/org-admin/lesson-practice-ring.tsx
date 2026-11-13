/** Small practice ring for lesson cards; same track + arc language as the family PracticeRing. */
export function LessonPracticeRing({
  practiceMin,
  targetMin,
  muted,
  size = 18,
}: {
  practiceMin: number | null;
  targetMin: number | null;
  /** Family hasn't joined yet: ring is shown greyed out. */
  muted: boolean;
  size?: number;
}) {
  const stroke = Math.max(2.5, size / 6);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = targetMin && targetMin > 0 ? Math.max(0, Math.min(1, (practiceMin ?? 0) / targetMin)) : 0;
  const color = muted || !targetMin
    ? "var(--text-disabled)"
    : pct >= 1
      ? "var(--accent)"
      : "var(--attention)";
  const label = muted
    ? "Practice not tracked until the family joins"
    : targetMin
      ? `${practiceMin ?? 0} of ${targetMin} practice minutes last week`
      : "No practice target set";
  return (
    <svg width={size} height={size} className="shrink-0" role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
        stroke={`color-mix(in oklab, ${color} ${muted ? 45 : 25}%, transparent)`} />
      {!muted && pct > 0 && (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      )}
    </svg>
  );
}
