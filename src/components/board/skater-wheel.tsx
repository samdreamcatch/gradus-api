import { useCallback, useEffect, useRef, useState } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { LANE_STYLE, SkaterBody, type LaneTone } from "@/components/board/lane-parts";
import { cn } from "@/lib/utils";
import type { BoardSkater } from "@/lib/board-types";

/** Height of one card slot, in px. */
const STEP = 84;
/** Drag distance that advances one card — shorter than a slot so a thumb flick moves it. */
const DRAG_STEP = 60;
/** How many cards are rendered on either side of the centre. */
const WINDOW = 2;
/** Movement past which a gesture counts as a drag, not a tap. */
const SLOP = 6;

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
  const container = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ id: number; y: number; moved: number } | null>(null);
  const frame = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const boundsRef = useRef({ centre: 0, last: 0 });

  const last = startOrder.length - 1;
  boundsRef.current = { centre: activeIndex - step, last };

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

  const apply = useCallback((raw: number) => {
    const { centre, last: end } = boundsRef.current;
    const min = centre - end; // dragging up, toward the end of the order
    const max = centre; // dragging down, toward the start
    let next = raw;
    if (raw > max) next = max + (raw - max) * 0.25;
    else if (raw < min) next = min + (raw - min) * 0.25;
    offsetRef.current = next;
    setOffset(next);
  }, []);

  /** Animate offset from -> to over dur, then run `then`. */
  const animate = useCallback(
    (from: number, to: number, dur: number, ease: (t: number) => number, then?: () => void) => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / dur);
        const value = t < 1 ? from + (to - from) * ease(t) : to;
        offsetRef.current = value;
        setOffset(value);
        if (t < 1) frame.current = requestAnimationFrame(tick);
        else then?.();
      };
      frame.current = requestAnimationFrame(tick);
    },
    [],
  );

  const settle = useCallback(() => {
    const from = offsetRef.current;
    if (from === 0) return;
    if (prefersReducedMotion()) {
      offsetRef.current = 0;
      setOffset(0);
      return;
    }
    const { centre, last: end } = boundsRef.current;
    // Snap to a whole card first — the detent — then return to the live skater.
    const snapped = Math.max(centre - end, Math.min(centre, Math.round(from)));
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    const back = () => {
      const held = offsetRef.current;
      if (held === 0) return;
      window.setTimeout(() => {
        animate(held, 0, 320, (t) => 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 0.5));
      }, 110);
    };
    if (Math.abs(snapped - from) < 0.01) back();
    else animate(from, snapped, 180, easeOut, back);
  }, [animate]);


  // Native, non-passive listeners: React's synthetic handlers can't reliably
  // preventDefault the scroll on touch, which is what stopped the wheel turning.
  useEffect(() => {
    const el = container.current;
    if (!el) return;

    const down = (e: PointerEvent) => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      drag.current = { id: e.pointerId, y: e.clientY, moved: 0 };
      el.setPointerCapture(e.pointerId);
    };

    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dy = e.clientY - d.y;
      d.moved = Math.max(d.moved, Math.abs(dy));
      if (d.moved < SLOP) return;
      if (e.cancelable) e.preventDefault();
      apply(dy / DRAG_STEP);
    };

    const end = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      // Keep `moved` readable for one tick so a drag doesn't fire the card's click.
      window.setTimeout(() => {
        drag.current = null;
      }, 0);
      settle();
    };

    const block = (e: TouchEvent) => {
      if ((drag.current?.moved ?? 0) >= SLOP && e.cancelable) e.preventDefault();
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move, { passive: false });
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("touchmove", block, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      el.removeEventListener("touchmove", block);
    };
  }, [apply, settle]);

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
        ref={container}
        className="relative select-none overflow-hidden"
        style={{
          height: STEP * 3,
          touchAction: "none",
          maskImage: EDGE_MASK,
          WebkitMaskImage: EDGE_MASK,
        }}
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
                  transform: `translateY(calc(-50% + ${pos * (STEP - 6)}px)) scale(${Math.max(0.96, 1 - away * 0.02)})`,
                  opacity: Math.max(0, 1 - away * 0.18),
                  zIndex: 10 - Math.round(away),
                }}
              >
                <div
                  role={tappable ? "button" : undefined}
                  tabIndex={tappable ? 0 : undefined}
                  onClick={() => {
                    if (tappable && (drag.current?.moved ?? 0) < SLOP) onOpenScore!(skater);
                  }}
                  onKeyDown={(e) => {
                    if (tappable && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onOpenScore!(skater);
                    }
                  }}
                  aria-label={tappable ? `${label}: ${skater.name} — open score detail` : undefined}
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
          onClick={() => setStep((s) => Math.min(activeIndex, s + 1))}
          disabled={nearest <= 0}
          className="press-soft rounded-md px-3 py-1 font-mono text-nano uppercase tracking-wider text-text-tertiary disabled:opacity-40"
        >
          ‹ earlier skater
        </button>
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(activeIndex - last, s - 1))}
          disabled={nearest >= last}
          className="press-soft rounded-md px-3 py-1 font-mono text-nano uppercase tracking-wider text-text-tertiary disabled:opacity-40"
        >
          later skater ›
        </button>
      </div>
    </div>
  );
}
