import { ClubNumber } from "./club-number";

export function ClubMeter({
  value,
  target,
}: {
  value: number | null | undefined;
  target: number | null | undefined;
}) {
  if (
    value == null ||
    target == null ||
    target <= 0 ||
    !Number.isFinite(value) ||
    !Number.isFinite(target)
  )
    return <ClubNumber value={null} />;
  const percentage = Math.round((value / target) * 100);
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <svg
        width="64"
        height="6"
        viewBox="0 0 64 6"
        aria-hidden="true"
        className="shrink-0 overflow-hidden rounded-full"
      >
        <rect width="64" height="6" className="fill-divider" />
        <rect
          width={Math.min(64, Math.max(0, (value / target) * 64))}
          height="6"
          className="fill-accent-ink"
        />
      </svg>
      <ClubNumber value={percentage} percentage />
    </span>
  );
}
