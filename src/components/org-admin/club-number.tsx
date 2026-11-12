import { cn } from "@/lib/utils";

export function ClubNumber({
  value,
  percentage = false,
}: {
  value: number | null | undefined;
  percentage?: boolean;
}) {
  if (value == null || !Number.isFinite(value)) {
    return (
      <span className="font-mono tabular-nums text-text-tertiary font-normal" aria-label="No value">
        –
      </span>
    );
  }
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        value === 0 ? "text-text-tertiary font-normal" : "text-text-primary font-medium",
      )}
    >
      {Math.round(value).toLocaleString()}
      {percentage ? "%" : ""}
    </span>
  );
}
