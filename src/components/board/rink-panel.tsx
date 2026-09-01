import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { BoardRink, BoardSkater } from "@/lib/board-types";

/** `2026-08-31T18:20:00Z` -> `in 12 min`, or `now`. */
export function untilLabel(iso: string | null): string {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  return `in ${h}h ${mins % 60}m`;
}

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

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

function Lane({
  tone,
  label,
  skater,
  awaiting,
  onOpenScore,
}: {
  tone: LaneTone;
  label: string;
  skater: BoardSkater | null;
  awaiting?: boolean;
  onOpenScore?: (s: BoardSkater) => void;
}) {
  const style = LANE_STYLE[tone];
  const tappable = !!skater?.protocol && !!onOpenScore;
  const Wrapper = tappable ? "button" : "div";

  return (
    <Wrapper
      {...(tappable
        ? {
            type: "button" as const,
            onClick: () => onOpenScore!(skater!),
            "aria-label": `${label}: ${skater!.name} — open score detail`,
          }
        : {})}
      className={cn(
        "block w-full rounded-xl border-l-4 px-4 py-3 text-left",
        style.border,
        tappable && "press-soft",
      )}
    >
      <Eyebrow size="micro" className={cn("block", style.label)}>
        {label}
      </Eyebrow>

      {skater ? (
        <SkaterBody
          skater={skater}
          tone={tone}
          awaiting={awaiting}
          showDetailHint={tappable}
        />
      ) : (
        <p className="mt-2 text-sm text-text-tertiary">—</p>
      )}
    </Wrapper>
  );
}


export function RinkPanel({
  rink,
  onOpenScore,
}: {
  rink: BoardRink;
  onOpenScore?: (s: BoardSkater) => void;
}) {
  const current = rink.current;

  return (
    <Card variant="section" className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-h3 text-text-primary">{rink.name}</h2>
        {rink.state === "live" ? (
          <Tag size="caption" tone="accent">
            LIVE
          </Tag>
        ) : (
          <Tag size="caption">IDLE</Tag>
        )}
      </div>

      {current ? (
        <>
          <div>
            <p className="font-display text-lg leading-snug text-text-primary">{current.event}</p>
            <p className="mt-1 font-mono text-xs text-text-tertiary">
              {current.segment ? `${current.segment} · ` : ""}
              {current.done} of {current.skaters} skated
              {current.withdrawn ? ` · ${current.withdrawn} withdrawn` : ""}
              {current.startLabel ? ` · ${current.startLabel}` : ""}
            </p>
            {rink.alsoLive.length > 0 ? (
              <p className="mt-1 font-mono text-xs text-text-tertiary">
                also live: {rink.alsoLive.join(", ")}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Lane
              tone="just"
              label="JUST SCORED"
              skater={current.justScored}
              onOpenScore={onOpenScore}
            />
            <Lane tone="ice" label="ON THE ICE" skater={current.onIce} awaiting />
            <Lane tone="next" label="UP NEXT" skater={current.upNext} />
          </div>
        </>
      ) : (
        <div className="space-y-2 py-4 text-center">
          <p className="font-hand text-base text-text-tertiary">nothing on the ice</p>
          {rink.next ? (
            <>
              <p className="font-mono text-h2 leading-none text-text-secondary tabular-nums">
                {untilLabel(rink.next.startIso)}
              </p>
              <p className="mx-auto max-w-sm font-display text-base text-text-secondary">
                {rink.next.event}
              </p>
            </>
          ) : (
            <p className="text-sm text-text-tertiary">No more events on this sheet today.</p>
          )}
          {rink.justFinished?.winner ? (
            <p className="font-mono text-xs text-text-tertiary">
              just finished: {rink.justFinished.winner.name} won with{" "}
              {rink.justFinished.winner.score}
            </p>
          ) : null}
        </div>
      )}

      {current && rink.next ? (
        <>
          <Separator />
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Eyebrow size="micro" tone="tertiary">
              NEXT
            </Eyebrow>
            <span className="font-mono text-sm text-text-secondary tabular-nums">
              {timeLabel(rink.next.startIso)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
              {rink.next.event}
            </span>
            <span className="font-mono text-xs text-text-tertiary">
              {untilLabel(rink.next.startIso)}
            </span>
          </div>
        </>
      ) : null}
    </Card>
  );
}
