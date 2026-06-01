import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useAnimationControls } from "framer-motion";
import { ArrowLeft, ArrowRight, ChevronDown, MessageCircle, Pause, Play, Settings, X } from "lucide-react";
import { toast } from "sonner";
import { AthleteBottomNav } from "@/components/athlete/bottom-nav";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  getAthletePlan,
  type AthletePlanMoveDTO,
} from "@/lib/athlete-plans.functions";
import { submitAthletePlanSession } from "@/lib/plan-sessions.functions";

export const Route = createFileRoute("/_authenticated/athlete/plans/$planId")({
  component: AthletePlanDetail,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Link
        to="/athlete/plans"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" /> Back
      </Link>
      <div className="mt-6 rounded-2xl border border-divider bg-card p-6 text-sm text-text-secondary">
        Couldn&apos;t load this plan: {error.message}
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-text-secondary">
      Plan not found.
    </div>
  ),
});

function AthletePlanDetail() {
  const { planId } = Route.useParams();
  const fetchPlan = useServerFn(getAthletePlan);
  const { data, isLoading } = useQuery({
    queryKey: ["athlete-plan", planId],
    queryFn: () => fetchPlan({ data: { id: planId } }),
  });

  const plan = data?.plan;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setExpanded((s) => ({ ...s, [id]: !s[id] }));

  const soon = (label: string) => toast(`${label} — coming soon`);

  if (isLoading || !plan) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center text-sm text-text-secondary">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pt-4 pb-24">
      <div className="flex items-center justify-between">
        <Link
          to="/athlete/plans"
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="size-4" /> Back
        </Link>
      </div>

      <div className="mt-4">
        <p className="text-[12px] font-medium text-text-secondary">
          Coach {plan.coachName}
        </p>
        <h1 className="mt-0.5 font-display text-4xl font-black leading-[0.95] tracking-tight text-text-primary">
          {plan.title}
        </h1>
      </div>

      <SessionTimer
        planId={plan.id}
        coachFirstName={plan.coachFirstName}
        athleteFirstName={plan.athleteFirstName}
        planTitle={plan.title}
      />


      <p className="mt-5 text-[11px] font-black uppercase tracking-widest text-text-secondary">
        From the Coach
      </p>

      <div className="mt-2 space-y-1.5">
        {plan.moves.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-divider bg-card p-4 text-center">
            <p className="font-hand text-xl text-text-secondary">
              No moves in this plan yet.
            </p>
          </div>
        ) : (
          plan.moves.map((m) => (
            <MoveCard
              key={m.id}
              move={m}
              expanded={!!expanded[m.id]}
              onToggle={() => toggle(m.id)}
            />
          ))
        )}
      </div>

      <div className="mt-5 flex justify-center">
        <button
          type="button"
          onClick={() => soon(`Message ${plan.coachFirstName}`)}
          className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-bold text-accent-foreground shadow-card"
        >
          <MessageCircle className="size-4" />
          Message {plan.coachFirstName} about this plan
        </button>
      </div>

      <AthleteBottomNav />
    </div>
  );
}

function MoveCard({
  move,
  expanded,
  onToggle,
}: {
  move: AthletePlanMoveDTO;
  expanded: boolean;
  onToggle: () => void;
}) {
  const unit = move.targetKind === "mins" ? "min" : "reps";
  const [shown, setShown] = useState<{ cue: boolean; why: boolean }>({
    cue: false,
    why: false,
  });
  const show = (kind: "cue" | "why") => setShown((s) => ({ ...s, [kind]: true }));
  const hide = (kind: "cue" | "why") => setShown((s) => ({ ...s, [kind]: false }));

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card shadow-card transition-colors",
        expanded ? "border-accent" : "border-divider",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3.5 py-2 text-left"
        aria-expanded={expanded}
      >
        <span className="flex shrink-0 items-baseline gap-1 tabular-nums">
          <span className="font-display text-[18px] font-black text-text-primary">
            {move.targetValue}
          </span>
          <span className="text-[11px] text-text-tertiary">{unit}</span>
        </span>
        <span className="flex-1 font-display text-[15px] text-text-primary">
          {move.name}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-text-tertiary transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded ? (
        <div className="space-y-2 px-3.5 pb-3">
          {move.description ? (
            <p className="text-[15px] leading-relaxed text-text-primary">
              {move.description}
            </p>
          ) : null}

          {shown.cue && move.cue ? (
            <CoachNote
              label="How to cue this"
              body={move.cue}
              onClose={() => hide("cue")}
            />
          ) : null}
          {shown.why && move.why ? (
            <CoachNote
              label="Why it's assigned"
              body={move.why}
              onClose={() => hide("why")}
            />
          ) : null}

          <div className="flex flex-wrap gap-2">
            {!shown.cue && move.cue ? (
              <button
                type="button"
                onClick={() => show("cue")}
                className="rounded-full border border-accent/60 bg-card px-3 py-1.5 text-xs font-bold text-accent-ink hover:bg-accent/10"
              >
                How do I cue this?
              </button>
            ) : null}
            {!shown.why && move.why ? (
              <button
                type="button"
                onClick={() => show("why")}
                className="rounded-full border border-accent/60 bg-card px-3 py-1.5 text-xs font-bold text-accent-ink hover:bg-accent/10"
              >
                Why is this assigned?
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CoachNote({
  label,
  body,
  onClose,
}: {
  label: string;
  body: string;
  onClose: () => void;
}) {
  return (
    <div className="relative rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 pr-9">
      <p className="text-[10px] font-black uppercase tracking-widest text-accent-ink">
        {label}
      </p>
      <p className="mt-1 text-[15px] leading-relaxed text-text-primary">
        {body}
      </p>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Hide ${label}`}
        className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-full text-text-tertiary hover:bg-card hover:text-text-primary"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function SessionTimer({
  planId,
  coachFirstName,
  athleteFirstName,
  planTitle,
}: {
  planId: string;
  coachFirstName: string;
  athleteFirstName: string;
  planTitle: string;
}) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds
  const [showFeedback, setShowFeedback] = useState(false);
  const startRef = useRef<number | null>(null);
  const baseRef = useRef(0);

  const queryClient = useQueryClient();
  const submitFn = useServerFn(submitAthletePlanSession);
  const submitMutation = useMutation({
    mutationFn: submitFn,
    onSuccess: () => {
      // Refresh charts wherever this plan appears (athlete, parent, coach).
      queryClient.invalidateQueries({ queryKey: ["plan-sessions", planId] });
      queryClient.invalidateQueries({ queryKey: ["athlete-plan", planId] });
      queryClient.invalidateQueries({ queryKey: ["athlete-plans"] });
      queryClient.invalidateQueries({ queryKey: ["parent-plan", planId] });
      queryClient.invalidateQueries({ queryKey: ["parent-plans"] });
      queryClient.invalidateQueries({ queryKey: ["coach-plans"] });
    },
  });

  useEffect(() => {
    if (!running) return;
    startRef.current = Date.now();
    const tick = () => {
      setElapsed(baseRef.current + Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => {
      window.clearInterval(id);
      baseRef.current = baseRef.current + Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000);
    };
  }, [running]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const started = running || elapsed > 0;

  const handleStart = () => setRunning(true);
  const handleTogglePause = () => setRunning((r) => !r);
  const handleEnd = () => {
    setRunning(false);
    setShowFeedback(true);
  };
  const handleDiscard = () => {
    setRunning(false);
    baseRef.current = 0;
    setElapsed(0);
  };
  const closeFeedback = () => {
    setShowFeedback(false);
    // Closing without an explicit submit also resets so the parent can re-start fresh.
    baseRef.current = 0;
    setElapsed(0);
  };

  return (
    <>
      <div className="mt-4">
        {started ? (
          <RunningPill
            mm={mm}
            ss={ss}
            running={running}
            coachFirstName={coachFirstName}
            onTogglePause={handleTogglePause}
            onEnd={handleEnd}
            onDiscard={handleDiscard}
          />
        ) : (
          <IdleSlide onStart={handleStart} />
        )}
      </div>

      <SessionFeedbackModal
        open={showFeedback}
        onOpenChange={(open) => (open ? setShowFeedback(true) : closeFeedback())}
        elapsed={`${mm}:${ss}`}
        planTitle={planTitle}
        coachFirstName={coachFirstName}
        athleteFirstName={athleteFirstName}
        onSubmit={async (payload) => {
          try {
            await submitMutation.mutateAsync({
              data: {
                planId,
                stateIndex: payload.stateIndex,
                note: payload.note,
                durationSeconds: elapsed,
              },
            });
            toast(`Sent to Coach ${coachFirstName}`, {
              description: `Your session · ${payload.stateLabel}`,
            });
            closeFeedback();
          } catch (e) {
            toast.error("Couldn't submit feedback", {
              description: e instanceof Error ? e.message : "Please try again.",
            });
          }
        }}
      />
    </>
  );
}

/** Idle state — slide right to start logging session time. */
function IdleSlide({ onStart }: { onStart: () => void }) {
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
      className="relative overflow-hidden rounded-full border border-accent/40 bg-accent/15 p-1.5"
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
            info.offset.x >= max * 0.2 ||
            (info.offset.x >= max * 0.1 && info.velocity.x > 150);
          await controls.start({
            x: 0,
            transition: { type: "spring", stiffness: 520, damping: 22, mass: 0.7 },
          });
          if (triggered) onStart();
          setArmed(false);
        }}
        style={{ touchAction: "pan-y" }}
        className={cn(
          "relative z-10 inline-flex h-10 select-none items-center gap-2 rounded-full bg-accent pl-4 pr-5 text-sm font-bold text-accent-foreground shadow-sm",
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
function RunningPill({
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
        onClick={onTogglePause}
        aria-label={running ? "Pause session timer" : "Resume session timer"}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-attention/15 text-attention-ink ring-1 ring-attention/40"
      >
        {running ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>

      {/* End-session slide track — pink to signal action required */}
      <div
        ref={trackRef}
        className="relative flex-1 overflow-hidden rounded-full border border-attention/50 bg-attention/15 p-1.5"
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
              info.offset.x >= max * 0.2 ||
              (info.offset.x >= max * 0.1 && info.velocity.x > 150);
            await controls.start({
              x: 0,
              transition: { type: "spring", stiffness: 520, damping: 22, mass: 0.7 },
            });
            if (triggered) onEnd();
            setArmed(false);
          }}
          style={{ touchAction: "pan-y" }}
          className={cn(
            "relative z-10 inline-flex h-10 select-none items-center gap-2 rounded-full bg-attention pl-3 pr-4 text-sm font-bold text-attention-foreground shadow-sm",
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


/** Five-point flow-state scale based on Csikszentmihalyi, framed for parents. */
const FLOW_STATES: { label: string; blurb: string }[] = [
  {
    label: "Frustrated",
    blurb: "Stuck, irritated, or shutting down. The challenge felt bigger than the skill today.",
  },
  {
    label: "Pushing",
    blurb: "Working hard against friction. Effort is there but it isn't clicking yet.",
  },
  {
    label: "Steady",
    blurb: "Focused and engaged. Working through the plan at a sustainable pace.",
  },
  {
    label: "Locked In",
    blurb: "Sharp, confident, losing track of time. Skill is rising to meet the challenge.",
  },
  {
    label: "Flowing",
    blurb: "Effortless and alive. Everything is clicking — a peak day to remember.",
  },
];

type FeedbackPayload = { stateIndex: number; stateLabel: string; note: string };

function SessionFeedbackModal({
  open,
  onOpenChange,
  elapsed,
  planTitle,
  coachFirstName,
  athleteFirstName,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  elapsed: string;
  planTitle: string;
  coachFirstName: string;
  athleteFirstName: string;
  onSubmit: (payload: FeedbackPayload) => void;
}) {
  const [stateIndex, setStateIndex] = useState<number | null>(null);
  const [note, setNote] = useState("");

  // Reset whenever the modal opens fresh.
  useEffect(() => {
    if (open) {
      setStateIndex(null);
      setNote("");
    }
  }, [open]);

  const selected = stateIndex !== null ? FLOW_STATES[stateIndex] : null;
  const canSubmit = stateIndex !== null;

  const handleSubmit = () => {
    if (stateIndex === null) return;
    onSubmit({ stateIndex, stateLabel: FLOW_STATES[stateIndex].label, note: note.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="text-[11px] font-black uppercase tracking-widest text-text-secondary">
            Session complete · {elapsed}
          </p>
          <DialogTitle className="font-display text-2xl font-black leading-tight text-text-primary">
            {planTitle}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Report back to Coach {coachFirstName} on how {athleteFirstName} showed up.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-5">
          <div>
            <p className="font-display text-lg font-bold leading-snug text-text-primary">
              How did today feel?
            </p>

            <FlowStateScale
              value={stateIndex}
              onChange={setStateIndex}
              endLabels={["Frustrated", "Steady", "Flowing"]}
            />

            <div className="mt-3 min-h-[3.25rem] px-1">
              {selected ? (
                <>
                  <p className="text-[11px] font-black uppercase tracking-widest text-accent-ink">
                    {selected.label}
                  </p>
                  <p className="font-hand text-xl leading-snug text-text-primary">
                    {selected.blurb}
                  </p>
                </>
              ) : (
                <p className="font-hand text-xl leading-snug text-text-tertiary">
                  Tap a dot to describe today's energy.
                </p>
              )}
            </div>
          </div>

          <div>
            <label
              htmlFor="session-feedback-note"
              className="text-[11px] font-black uppercase tracking-widest text-text-secondary"
            >
              Anything else to share?
            </label>
            <textarea
              id="session-feedback-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="What stood out, what to watch for, questions for coach…"
              className="mt-1.5 w-full resize-none rounded-xl border border-divider bg-card px-3 py-2 text-[15px] leading-relaxed text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              "w-full rounded-full px-5 py-3 text-sm font-bold shadow-card transition-opacity",
              canSubmit
                ? "bg-accent text-accent-foreground"
                : "cursor-not-allowed bg-divider text-text-tertiary opacity-70",
            )}
          >
            Submit to Coach {coachFirstName}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FlowStateScale({
  value,
  onChange,
  endLabels,
}: {
  value: number | null;
  onChange: (i: number) => void;
  endLabels: [string, string, string];
}) {
  return (
    <div className="mt-4 px-1">
      <div className="relative">
        <div className="pointer-events-none absolute left-5 right-5 top-1/2 z-0 border-t-2 border-text-primary" />
        <div className="relative z-10 flex h-10 items-center justify-between">
          {FLOW_STATES.map((s, i) => {
            const active = value === i;
            return (
              <button
                key={s.label}
                type="button"
                onClick={() => onChange(i)}
                aria-label={s.label}
                aria-pressed={active}
                className="group relative inline-flex size-10 items-center justify-center"
              >
                <span
                  className={cn(
                    "block rounded-full border-2 border-text-primary bg-card transition-all",
                    active
                      ? "size-5 bg-accent"
                      : "size-3 group-hover:bg-text-primary/20",
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-black uppercase tracking-widest text-text-tertiary">
        <span>{endLabels[0]}</span>
        <span>{endLabels[1]}</span>
        <span>{endLabels[2]}</span>
      </div>
    </div>
  );
}

