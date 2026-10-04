import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { BoardSkater } from "@/lib/board-types";

export type LaneTone = "just" | "ice" | "next";

export const LANE_STYLE: Record<LaneTone, { border: string; label: string; score: string }> = {
  just: {
    border: "border-l-secondary-accent",
    label: "text-secondary-accent-ink",
    score: "text-secondary-accent-ink",
  },
  ice: {
    border: "border-l-accent",
    label: "text-accent-ink",
    score: "text-accent-ink",
  },
  next: {
    border: "border-l-accent/40",
    label: "text-text-secondary",
    score: "text-text-tertiary",
  },
};

const LANE_WASH: Record<LaneTone, string> = {
  just: "color-mix(in oklab, var(--secondary-accent-wash) 40%, transparent)",
  ice: "color-mix(in oklab, var(--accent) 10%, transparent)",
  next: "color-mix(in oklab, var(--accent) 5%, transparent)",
};

/**
 * A lane's surface, opaque: the lane wash over the card tint over the page.
 * In the wheel, cards slide past each other; a see-through card let the one
 * behind show through its text (Mariah, 2026-10-03).
 */
export function laneSurface(tone: LaneTone): CSSProperties {
  const wash = LANE_WASH[tone];
  return {
    background: `linear-gradient(${wash}, ${wash}), linear-gradient(var(--card), var(--card)), var(--background)`,
  };
}

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
