import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Five-point flow-state scale based on Csikszentmihalyi. */
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

export type FeedbackPayload = {
  /** The session's rating; null for an each-move check-in (the server averages the moves). */
  stateIndex: number | null;
  stateLabel: string;
  note: string;
  /** Each-move check-ins: the moves that were rated. A skipped move is left out. */
  moveRatings?: { planMoveId: string; stateIndex: number }[];
};

export type FeedbackMove = { id: string; name: string };

export function SessionFeedbackModal({
  open,
  onOpenChange,
  elapsed,
  planTitle,
  coachFirstName,
  athleteFirstName,
  viewerIsAthlete,
  moves,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  elapsed: string;
  planTitle: string;
  coachFirstName: string;
  athleteFirstName: string;
  viewerIsAthlete: boolean;
  /** Set when the coach asked for feedback on each move: one move at a time. */
  moves?: FeedbackMove[];
  onSubmit: (payload: FeedbackPayload) => void;
}) {
  const [stateIndex, setStateIndex] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [moveRatings, setMoveRatings] = useState<Record<string, number>>({});
  const [step, setStep] = useState(0);
  const eachMove = (moves?.length ?? 0) > 0;

  useEffect(() => {
    if (open) {
      setStateIndex(null);
      setNote("");
      setMoveRatings({});
      setStep(0);
    }
  }, [open]);

  const selected = stateIndex !== null ? FLOW_STATES[stateIndex] : null;
  const ratedCount = Object.keys(moveRatings).length;
  const canSubmit = eachMove ? ratedCount > 0 : stateIndex !== null;

  const rateMove = (moveId: string, value: number) => {
    setMoveRatings((r) => ({ ...r, [moveId]: value }));
    // Rating a move moves on to the next one.
    if (moves && step < moves.length - 1) setStep(step + 1);
  };

  const handleSubmit = () => {
    if (eachMove && moves) {
      if (ratedCount === 0) return;
      const ratings = moves
        .filter((m) => moveRatings[m.id] !== undefined)
        .map((m) => ({ planMoveId: m.id, stateIndex: moveRatings[m.id] }));
      onSubmit({
        stateIndex: null,
        stateLabel: `${ratings.length} of ${moves.length} moves rated`,
        note: note.trim(),
        moveRatings: ratings,
      });
      return;
    }
    if (stateIndex === null) return;
    onSubmit({
      stateIndex,
      stateLabel: FLOW_STATES[stateIndex].label,
      note: note.trim(),
    });
  };

  const subjectShowed = viewerIsAthlete ? "you showed" : `${athleteFirstName} showed`;
  const subjectShow = viewerIsAthlete ? "you show" : `${athleteFirstName} show`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="text-[11px] font-black uppercase tracking-widest text-accent-ink">
            Session complete · {elapsed}
          </p>
          <DialogTitle className="font-display text-2xl font-black leading-tight text-text-primary">
            {planTitle}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Report back to Coach {coachFirstName} on how {subjectShowed} up.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-5">
          {eachMove && moves ? (
            <MoveStep
              moves={moves}
              step={Math.min(step, moves.length - 1)}
              ratings={moveRatings}
              onRate={rateMove}
              onStep={setStep}
            />
          ) : (
            <div>
              <p className="font-display text-lg font-bold leading-snug text-text-primary">
                How did {subjectShow} up today?
              </p>

              <div className="mt-3 rounded-xl border border-divider bg-elevated px-3 pb-3 pt-1">
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
                      <p className="font-sans text-base leading-snug text-text-primary">
                        {selected.blurb}
                      </p>
                    </>
                  ) : (
                    <p className="font-sans text-base leading-snug text-text-tertiary">
                      Tap a dot to describe today&apos;s energy.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

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
              className="focus-input mt-1.5 w-full resize-none rounded-xl border border-divider bg-elevated px-3 py-2 text-[15px] leading-relaxed text-text-primary placeholder:text-text-tertiary"
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

/**
 * Each-move check-in: one move and one scale at a time. Dots show how far
 * along you are (a tick for each rated move); rating a move moves on.
 */
function MoveStep({
  moves,
  step,
  ratings,
  onRate,
  onStep,
}: {
  moves: FeedbackMove[];
  step: number;
  ratings: Record<string, number>;
  onRate: (moveId: string, value: number) => void;
  onStep: (step: number) => void;
}) {
  const move = moves[step];
  return (
    <div>
      <p className="font-display text-lg font-bold leading-snug text-text-primary">
        How did each move feel?
      </p>
      <div className="mt-3 rounded-xl border border-divider bg-elevated px-3 pb-3 pt-3">
        <div
          className="flex items-center gap-2.5 px-1"
          role="img"
          aria-label={`Move ${step + 1} of ${moves.length}`}
        >
          {moves.map((m, i) => (
            <span
              key={m.id}
              className={cn(
                "inline-flex size-3.5 items-center justify-center rounded-full border-[1.5px]",
                i === step
                  ? "border-accent-ink bg-accent"
                  : ratings[m.id] !== undefined
                    ? "border-accent-ink bg-card"
                    : "border-text-tertiary",
              )}
            >
              {i !== step && ratings[m.id] !== undefined ? (
                <span className="block size-1.5 rounded-full bg-accent-ink" />
              ) : null}
            </span>
          ))}
        </div>
        <p
          className="mt-3 px-1 font-display text-xl font-bold leading-tight text-text-primary"
          aria-live="polite"
        >
          {move.name}
        </p>
        <FlowStateScale
          key={move.id}
          value={ratings[move.id] ?? null}
          onChange={(v) => onRate(move.id, v)}
          endLabels={["Frustrated", "Steady", "Flowing"]}
          context={move.name}
        />
        <div className="mt-3 flex items-center justify-between px-1">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => onStep(step - 1)}
              className="press-soft rounded-full border border-border-strong px-3 py-1.5 text-xs font-bold text-text-primary"
            >
              Back
            </button>
          ) : (
            <span />
          )}
          {step < moves.length - 1 ? (
            <button
              type="button"
              onClick={() => onStep(step + 1)}
              className="press-soft rounded-full border border-border-strong px-3 py-1.5 text-xs font-bold text-text-primary"
            >
              Skip
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FlowStateScale({
  value,
  onChange,
  endLabels,
  context,
}: {
  value: number | null;
  onChange: (i: number) => void;
  endLabels: [string, string, string];
  /** The move being rated, so a screen reader says "Waltz jump: Steady". */
  context?: string;
}) {
  return (
    <div className="mt-4 px-1">
      <div className="relative">
        <div className="pointer-events-none absolute left-5 right-5 top-1/2 z-0 border-t-2 border-pen-pool-ink" />
        <div className="relative z-10 flex h-10 items-center justify-between">
          {FLOW_STATES.map((s, i) => {
            const active = value === i;
            return (
              <button
                key={s.label}
                type="button"
                onClick={() => onChange(i)}
                aria-label={context ? `${context}: ${s.label}` : s.label}
                aria-pressed={active}
                className="group relative inline-flex size-10 items-center justify-center"
              >
                <span
                  className={cn(
                    "block rounded-full border-2 border-pen-pool-ink bg-card transition-all",
                    active ? "size-5 bg-accent" : "size-3 group-hover:bg-pen-pool-ink/20",
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
