import { useRef, useState } from "react";
import { motion, useAnimationControls } from "framer-motion";
import { ArrowRight, Pause, Play, X } from "lucide-react";
import { haptic, hapticNotify } from "@/lib/native";
import { cn } from "@/lib/utils";

/** Idle state — slide right to start logging session time. */
export function IdleSlide({ onStart }: { onStart: () => void }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const controls = useAnimationControls();
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState(false);

  const getMax = () => {
    const t = trackRef.current?.getBoundingClientRect().width ?? 0;
    const k = knobRef.current?.getBoundingClientRect().width ?? 0;
    return Math.max(0, t - k - 12);
  };

  return (
    <div
      ref={trackRef}
      className="relative overflow-hidden rounded-full border border-accent/40 bg-accent/15 p-1"
    >
      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-accent-ink/60">
        Slide
        <ArrowRight className="size-3.5" />
      </span>

      <motion.div
        ref={knobRef}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.9 }}
        dragMomentum={false}
        animate={controls}
        onDragStart={() => {
          setDragging(true);
          setArmed(false);
        }}
        onDrag={(_, info) => {
          if (!armed && info.offset.x >= getMax() * 0.3) setArmed(true);
        }}
        onDragEnd={async (_, info) => {
          setDragging(false);
          const max = getMax();
          const triggered =
            info.offset.x >= max * 0.2 || (info.offset.x >= max * 0.1 && info.velocity.x > 150);
          await controls.start({
            x: 0,
            transition: { type: "spring", stiffness: 520, damping: 22, mass: 0.7 },
          });
          if (triggered) {
            void haptic("medium");
            onStart();
          }
          setArmed(false);
        }}
        style={{ touchAction: "pan-y" }}
        className={cn(
          "relative z-10 inline-flex h-8 select-none items-center gap-2 rounded-full bg-accent pl-3 pr-4 text-sm font-bold text-accent-foreground shadow-sm",
          "cursor-grab active:cursor-grabbing",
          dragging && "shadow-card",
          armed && "ring-2 ring-accent-foreground/50",
        )}
        aria-label="Slide to start session timer"
      >
        <Play className="size-4" />
        <span>Start session</span>
      </motion.div>
    </div>
  );
}

/** Running / paused state — pink attention pill with End-session slide. */
export function RunningPill({
  mm,
  ss,
  running,
  coachFirstName,
  onTogglePause,
  onEnd,
  onDiscard,
}: {
  mm: string;
  ss: string;
  running: boolean;
  coachFirstName: string;
  onTogglePause: () => void;
  onEnd: () => void;
  onDiscard: () => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const controls = useAnimationControls();
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState(false);

  const getMax = () => {
    const t = trackRef.current?.getBoundingClientRect().width ?? 0;
    const k = knobRef.current?.getBoundingClientRect().width ?? 0;
    return Math.max(0, t - k - 12);
  };

  return (
    <div className="flex items-center gap-2">
      {/* Pause / resume — tap only, no drag */}
      <button
        type="button"
        onClick={() => {
          void haptic("light");
          onTogglePause();
        }}
        aria-label={running ? "Pause session timer" : "Resume session timer"}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-attention/15 text-attention-ink ring-1 ring-attention/40"
      >
        {running ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>

      {/* End-session slide track — pink to signal action required */}
      <div
        ref={trackRef}
        className="relative flex-1 overflow-hidden rounded-full border border-attention/50 bg-attention/15 p-1"
      >
        <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-attention-ink/70">
          End
          <ArrowRight className="size-3.5" />
        </span>

        <motion.div
          ref={knobRef}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={{ left: 0, right: 0.9 }}
          dragMomentum={false}
          animate={controls}
          onDragStart={() => {
            setDragging(true);
            setArmed(false);
          }}
          onDrag={(_, info) => {
            if (!armed && info.offset.x >= getMax() * 0.3) setArmed(true);
          }}
          onDragEnd={async (_, info) => {
            setDragging(false);
            const max = getMax();
            const triggered =
              info.offset.x >= max * 0.2 || (info.offset.x >= max * 0.1 && info.velocity.x > 150);
            await controls.start({
              x: 0,
              transition: { type: "spring", stiffness: 520, damping: 22, mass: 0.7 },
            });
            if (triggered) {
              void hapticNotify("success");
              onEnd();
            }
            setArmed(false);
          }}
          style={{ touchAction: "pan-y" }}
          className={cn(
            "relative z-10 inline-flex h-8 select-none items-center gap-2 rounded-full bg-attention pl-3 pr-4 text-sm font-bold text-attention-foreground shadow-sm",
            "cursor-grab active:cursor-grabbing",
            dragging && "shadow-card",
            armed && "ring-2 ring-attention-foreground/60",
          )}
          aria-label={`End session and report back to ${coachFirstName}`}
        >
          {running ? (
            <span className="relative inline-flex size-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-attention-foreground opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-attention-foreground" />
            </span>
          ) : null}
          <span className="tabular-nums">
            {running ? "" : "Paused · "}
            {mm}:{ss}
          </span>
        </motion.div>
      </div>

      <button
        type="button"
        onClick={onDiscard}
        aria-label="Discard session"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-text-tertiary hover:bg-divider hover:text-text-primary"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
