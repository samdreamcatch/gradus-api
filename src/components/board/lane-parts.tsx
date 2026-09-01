import { cn } from "@/lib/utils";
import type { BoardSkater } from "@/lib/board-types";

export type LaneTone = "just" | "ice" | "next";

export const LANE_STYLE: Record<LaneTone, { border: string; label: string; score: string }> = {
  just: {
    border: "border-l-secondary-accent bg-secondary-accent-wash/40",
    label: "text-secondary-accent-ink",
    score: "text-secondary-accent-ink",
  },
  ice: {
    border: "border-l-accent bg-accent/10",
    label: "text-accent-ink",
    score: "text-accent-ink",
  },
  next: {
    border: "border-l-accent/40 bg-accent/5",
    label: "text-text-secondary",
    score: "text-text-tertiary",
  },
};

/** The inner row of a lane — shared by the static panel and the rotary wheel. */
export function SkaterBody({
  skater,
  tone,
  awaiting,
  showDetailHint,
}: {
  skater: BoardSkater;
  tone: LaneTone;
  awaiting?: boolean;
  showDetailHint?: boolean;
}) {
  const style = LANE_STYLE[tone];
  return (
    <div className="mt-2 flex items-center gap-4">
      <div className="shrink-0 text-center font-mono tabular-nums">
        <span className="block text-h3 leading-none text-text-primary">{skater.start}</span>
        <span className="mt-1 block text-nano text-text-tertiary">of {skater.of}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-bold leading-tight text-text-primary">{skater.name}</p>
        {skater.club ? <p className="truncate text-sm text-text-tertiary">{skater.club}</p> : null}
      </div>
      <div className="shrink-0 text-right font-mono tabular-nums">
        {skater.segScore ? (
          <>
            <span className={cn("block text-h3 leading-none", style.score)}>{skater.segScore}</span>
            {skater.total || skater.place ? (
              <span className="mt-1 block text-nano text-text-tertiary">
                {skater.total ? `total ${skater.total}` : ""}
                {skater.total && skater.place ? " · " : ""}
                {skater.place ? `${skater.place}` : ""}
              </span>
            ) : null}
            {showDetailHint ? (
              <span className="mt-1 block text-nano text-text-tertiary">score detail ›</span>
            ) : null}
          </>
        ) : awaiting ? (
          <span className="font-hand text-sm text-text-tertiary">awaiting score</span>
        ) : null}
      </div>
    </div>
  );
}
