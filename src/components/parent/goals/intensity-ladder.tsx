import { cn } from "@/lib/utils";

export interface LadderStop {
  key: string;
  label: string;
}

interface Props {
  stops: LadderStop[];
  currentKey: string;
  goalKey: string;
}

/**
 * Presentational only. Shows a row of dots from `stops[0]` to last `stop`,
 * with the current level filled and the goal level outlined+ringed.
 */
export function IntensityLadder({ stops, currentKey, goalKey }: Props) {
  if (stops.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="relative flex items-center">
        <div className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-divider" aria-hidden />
        <div className="relative z-10 flex w-full items-center justify-between">
          {stops.map((s) => {
            const isCurrent = s.key === currentKey;
            const isGoal = s.key === goalKey;
            return (
              <div
                key={s.key}
                className={cn(
                  "h-3 w-3 rounded-full border-2",
                  isCurrent && "border-accent bg-accent",
                  isGoal && !isCurrent && "border-accent bg-card ring-2 ring-accent/30",
                  !isCurrent && !isGoal && "border-divider bg-card",
                )}
                aria-label={`${s.label}${isCurrent ? " — current" : isGoal ? " — goal" : ""}`}
              />
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
        {stops.map((s) => (
          <span key={s.key} className="max-w-[20%] text-center leading-tight">
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
