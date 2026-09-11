import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { BoardCurrent, BoardRink, BoardSkater } from "@/lib/board-types";
import { LANE_STYLE, SkaterBody, type LaneTone } from "@/components/board/lane-parts";
import { SkaterWheel } from "@/components/board/skater-wheel";

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
  const tappable = !!skater && !!onOpenScore;
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
          showDetailHint={tappable && !!skater.protocol}
        />
      ) : (
        <p className="mt-2 text-sm text-text-tertiary">—</p>
      )}
    </Wrapper>
  );
}

/** Index in the start order of the skater who represents "now". */
function liveIndex(current: BoardCurrent): number {
  const find = (s: BoardSkater | null) =>
    s ? current.startOrder.findIndex((r) => r.start === s.start && r.name === s.name) : -1;
  const ice = find(current.onIce);
  if (ice >= 0) return ice;
  const just = find(current.justScored);
  if (just >= 0) return just;
  const next = find(current.upNext);
  if (next >= 0) return next;
  return Math.max(0, Math.min(current.startOrder.length - 1, current.done));
}

export function RinkPanel({
  rink,
  onOpenScore,
  className,
}: {
  rink: BoardRink;
  onOpenScore?: (s: BoardSkater) => void;
  className?: string;
}) {
  const current = rink.current;

  return (
    <Card variant="section" className={cn("space-y-4", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-h3 text-text-primary">{rink.name}</h2>
        {rink.state === "live" ? (
          <Tag size="caption" tone="accent">
            LIVE
          </Tag>
        ) : null}
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

          {current.startOrder.length > 1 ? (
            <SkaterWheel
              startOrder={current.startOrder}
              activeIndex={liveIndex(current)}
              onOpenScore={onOpenScore}
            />
          ) : (
            <div className="space-y-2">
              <Lane
                tone="just"
                label="JUST SCORED"
                skater={current.justScored}
                onOpenScore={onOpenScore}
              />
              <Lane
                tone="ice"
                label="ON THE ICE"
                skater={current.onIce}
                awaiting
                onOpenScore={onOpenScore}
              />
              <Lane tone="next" label="UP NEXT" skater={current.upNext} onOpenScore={onOpenScore} />
            </div>
          )}
        </>
      ) : (
        <div className="flex justify-center py-6">
          <Tag size="caption">IDLE</Tag>
        </div>
      )}

      {rink.next ? (
        <>
          <Separator />
          <div className="rounded-md bg-elevated px-3 py-2">
            <div className="flex items-center gap-2">
              <Eyebrow size="micro" tone="tertiary">
                NEXT
              </Eyebrow>
              <span className="font-mono text-xs text-text-secondary tabular-nums">
                {timeLabel(rink.next.startIso)}
              </span>
              <span className="ml-auto font-mono text-xs text-text-tertiary">
                {untilLabel(rink.next.startIso)}
              </span>
            </div>
            <p className="mt-1 font-display text-sm leading-snug text-text-primary">
              {rink.next.event}
            </p>
          </div>
        </>
      ) : !current ? (
        <p className="text-center text-sm text-text-tertiary">
          No more events on this sheet today.
        </p>
      ) : null}
    </Card>
  );
}
