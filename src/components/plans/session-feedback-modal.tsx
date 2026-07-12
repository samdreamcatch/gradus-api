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
    blurb:
      "Stuck, irritated, or shutting down. The challenge felt bigger than the skill today.",
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
    blurb:
      "Sharp, confident, losing track of time. Skill is rising to meet the challenge.",
  },
  {
    label: "Flowing",
    blurb: "Effortless and alive. Everything is clicking — a peak day to remember.",
  },
];

export type FeedbackPayload = {
  stateIndex: number;
  stateLabel: string;
  note: string;
};

export function SessionFeedbackModal({
  open,
  onOpenChange,
  elapsed,
  planTitle,
  coachFirstName,
  athleteFirstName,
  viewerIsAthlete,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  elapsed: string;
  planTitle: string;
  coachFirstName: string;
  athleteFirstName: string;
  viewerIsAthlete: boolean;
  onSubmit: (payload: FeedbackPayload) => void;
}) {
  const [stateIndex, setStateIndex] = useState<number | null>(null);
  const [note, setNote] = useState("");

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
