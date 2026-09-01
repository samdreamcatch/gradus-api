import { useCallback, useEffect, useRef, useState } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { LANE_STYLE, SkaterBody, type LaneTone } from "@/components/board/rink-panel";
import { cn } from "@/lib/utils";
import type { BoardSkater } from "@/lib/board-types";

/** Height of one card slot, in px. Drag distance is measured in these units. */
const STEP = 84;
/** How many cards are rendered on either side of the centre. */
const WINDOW = 2;
/** Degrees of tilt per step away from the centre — the subtle arc. */
const TILT = 2;

function roleOf(delta: number): { tone: LaneTone; label: string } {
  if (delta === 0) return { tone: "ice", label: "ON THE ICE" };
  if (delta === -1) return { tone: "just", label: "JUST SCORED" };
  if (delta < 0) return { tone: "just", label: "SKATED" };
  if (delta === 1) return { tone: "next", label: "UP NEXT" };
  return { tone: "next", label: "LATER" };
}

function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function SkaterWheel({
  startOrder,
  activeIndex,
  onOpenScore,
}: {
  startOrder: BoardSkater[];
  activeIndex: number;
  onOpenScore?: (s: BoardSkater) => void;
}) {
  /** Live drag offset in card units. Positive = dragged down, showing earlier skaters. */
  const [offset, setOffset] = useState(0);
  /** Keyboard/button stepping, which does not spring back until reset. */
  const [step, setStep] = useState(0);
  const drag = useRef<{ id: number; y: number; moved: number } | null>(null);
  const frame = useRef<number | null>(null);

  const last = startOrder.length - 1;
  // Reset stepping whenever the underlying event or live skater moves on.
  useEffect(() => {
    setStep(0);
  }, [activeIndex, startOrder.length]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const clampOffset = useCallback(
    (raw: number) => {
      const centre = activeIndex - step;
      const min = centre - last; // dragging up, toward the end of the order
      const max = centre; // dragging down, toward the start
      if (raw > max) return max + (raw - max) * 0.25;
      if (raw < min) return min + (raw - min) * 0.25;
      return raw;
    },
    [activeIndex, step, last],
  );

  const settle = useCallback(() => {
    const from = offset;
    if (from === 0) return;
    if (prefersReducedMotion()) {
      setOffset(0);
      return;
    }
    const start = performance.now();
    const dur = 340;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      // Slight overshoot, then settle — the rotary spring.
      const eased = 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 0.9);
      setOffset(from * (1 - eased));
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else setOffset(0);
    };
    frame.current = requestAnimationFrame(tick);
  }, [offset]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    drag.current = { id: e.pointerId, y: e.clientY, moved: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y;
    d.moved = Math.max(d.moved, Math.abs(dy));
    setOffset(clampOffset(dy / STEP));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    settle();
  };

  const centre = activeIndex - step - offset;
  const nearest = Math.max(0, Math.min(last, Math.round(centre)));

  const cards: { skater: BoardSkater; index: number; pos: number }[] = [];
  for (let i = nearest - WINDOW; i <= nearest + WINDOW; i += 1) {
    if (i < 0 || i > last) continue;
    cards.push({ skater: startOrder[i], index: i, pos: i - centre });
  }

  return (
    <div className="space-y-2">
      <div
        className="relative touch-pan-x select-none overflow-hidden"
        style={{ height: STEP * 3 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <ol className="absolute inset-0 list-none">
          {cards.map(({ skater, index, pos }) => {
            const away = Math.abs(pos);
            const { tone, label } = roleOf(index - activeIndex);
            const style = LANE_STYLE[tone];
            const isCentre = index === nearest;
            const tappable = isCentre && !!skater.protocol && !!onOpenScore;
            return (
              <li
                key={`${skater.start}-${skater.name}`}
                aria-current={isCentre ? "true" : undefined}
                className="absolute inset-x-0 top-1/2"
                style={{
                  transform: `translateY(calc(-50% + ${pos * STEP}px)) rotate(${pos * TILT}deg) scale(${Math.max(0.86, 1 - away * 0.06)})`,
                  opacity: Math.max(0, 1 - away * 0.34),
                  zIndex: 10 - Math.round(away),
                  pointerEvents: isCentre ? "auto" : "none",
                }}
              >
                <div
                  role={tappable ? "button" : undefined}
                  tabIndex={tappable ? 0 : undefined}
                  onClick={() => {
                    if (tappable && (drag.current?.moved ?? 0) < 6) onOpenScore!(skater);
                  }}
                  onKeyDown={(e) => {
                    if (tappable && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onOpenScore!(skater);
                    }
                  }}
                  aria-label={
                    tappable ? `${label}: ${skater.name} — open score detail` : undefined
                  }
                  className={cn(
                    "mx-1 rounded-xl border-l-4 bg-card/60 px-4 py-3 text-left shadow-sm",
                    style.border,
                    tappable && "press-soft cursor-pointer",
                  )}
                >
                  <Eyebrow size="micro" className={cn("block", style.label)}>
                    {label}
                  </Eyebrow>
                  <SkaterBody
                    skater={skater}
                    tone={tone}
                    awaiting={index === activeIndex}
                    showDetailHint={tappable}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex justify-center gap-2">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(activeIndex - last, s - 1))}
          disabled={nearest <= 0}
          className="press-soft rounded-md px-3 py-1 font-mono text-nano uppercase tracking-wider text-text-tertiary disabled:opacity-40"
        >
          ‹ earlier skater
        </button>
        <button
          type="button"
          onClick={() => setStep((s) => Math.min(activeIndex, s + 1))}
          disabled={nearest >= last}
          className="press-soft rounded-md px-3 py-1 font-mono text-nano uppercase tracking-wider text-text-tertiary disabled:opacity-40"
        >
          later skater ›
        </button>
      </div>
    </div>
  );
}
