import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { getCoachChecklist } from "@/lib/coach-checklist.functions";
import { HelpBubble } from "@/components/coach/help-bubble";

export const coachChecklistQueryKey = ["coach", "getting-started"] as const;

type StepKey = "schedule" | "invite" | "plan";

function storageKey(coachId: string) {
  return `gradus.coachChecklist.${coachId}`;
}

type Stored = { seen?: boolean; minimized?: boolean };

function readStored(coachId: string): Stored {
  try {
    const raw = localStorage.getItem(storageKey(coachId));
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}

function writeStored(coachId: string, next: Stored) {
  try {
    localStorage.setItem(storageKey(coachId), JSON.stringify({ ...readStored(coachId), ...next }));
  } catch {
    /* ignore */
  }
}


/**
 * Three-step getting-started checklist for new coaches. It opens as an anchored
 * thought bubble, then minimizes into a small chat button and can be reopened.
 * Progress is derived from real data, so a step ticks itself off wherever the
 * coach did it.
 */
export function CoachGettingStarted({
  onStartSchedule,
  onStartInvite,
}: {
  onStartSchedule: () => void;
  onStartInvite: () => void;
}) {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: coachChecklistQueryKey,
    queryFn: () => getCoachChecklist(),
    staleTime: 30_000,
  });

  const [minimized, setMinimized] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const coachId = data?.coachId ?? null;

  useEffect(() => {
    if (!coachId) return;
    const stored = readStored(coachId);
    setMinimized(Boolean(stored.minimized));
    if (!stored.seen) {
      writeStored(coachId, { seen: true });
    }
  }, [coachId]);

  useEffect(() => {
    if (minimized) return;

    const onPointerDown = (event: PointerEvent) => {
      if (bubbleRef.current?.contains(event.target as Node)) return;
      setMinimized(true);
      if (coachId) writeStored(coachId, { minimized: true });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMinimized(true);
      if (coachId) writeStored(coachId, { minimized: true });
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [coachId, minimized]);

  const steps = useMemo(() => {
    if (!data) return [];
    return [
      {
        key: "schedule" as StepKey,
        title: "Upload or input your schedule",
        description: data.scheduleFromFamilies
          ? "Your connected families already added their lesson times — they're on your schedule and you can edit them."
          : "Add a photo of your schedule, a CSV, or type your lessons in.",
        cta: data.scheduleFromFamilies ? "View schedule" : "Add my schedule",
        done: data.scheduleDone,
        action: onStartSchedule,
      },
      {
        key: "invite" as StepKey,
        title: "Invite parents or adult athletes",
        description: "They join your roster and see plans, schedules, and progress.",
        cta: "Invite",
        done: data.inviteDone,
        action: onStartInvite,
      },
      {
        key: "plan" as StepKey,
        title: "Create your first practice plan",
        description: "Build a plan of moves and share it with an athlete.",
        cta: "Create a plan",
        done: data.planDone,
        action: () => navigate({ to: "/coach/plans" }),
      },
    ];
  }, [data, navigate, onStartInvite, onStartSchedule]);

  const doneCount = steps.filter((s) => s.done).length;
  const remaining = steps.length - doneCount;
  const allDone = steps.length > 0 && remaining === 0;
  const currentKey = steps.find((s) => !s.done)?.key ?? null;

  const minimize = () => {
    setMinimized(true);
    if (coachId) writeStored(coachId, { minimized: true });
  };

  const restore = () => {
    setMinimized(false);
    if (coachId) writeStored(coachId, { minimized: false });
  };

  if (!data || !coachId || allDone) return null;

  const body = (
    <ChecklistBody
      steps={steps}
      currentKey={currentKey}
      onAct={(fn) => {
        minimize();
        fn();
      }}
    />
  );

  return (
    <div
      ref={bubbleRef}
      className="fixed right-4 bottom-24 z-30 flex max-w-[calc(100vw-2rem)] flex-col items-end"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <HelpBubble
        open={!minimized}
        onOpen={restore}
        onClose={minimize}
        title="Get set up"
        meta={`${doneCount} / ${steps.length}`}
        badge={remaining}
        openLabel={`Get set up — ${remaining} steps left`}
        closeLabel="Minimize getting started"
      >
        {body}
      </HelpBubble>
    </div>
  );
}

export type Step = {
  key: string;
  title: string;
  description: string;
  cta: string;
  done: boolean;
  action: () => void;
};

export function ChecklistBody({
  steps,
  currentKey,
  onAct,
}: {
  steps: Step[];
  currentKey: StepKey | null;
  onAct: (fn: () => void) => void;
}) {
  return (
    <ul>
      {steps.map((step, i) => {
        const isCurrent = step.key === currentKey;
        return (
          <li key={step.key} className={cn(i > 0 && "border-t border-divider")}>
            {isCurrent ? (
              <div className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <StepMark done={false} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-text-primary">{step.title}</p>
                    <p className="mt-1 text-xs text-text-secondary">{step.description}</p>
                    <Button
                      type="button"
                      size="sm"
                      className="mt-3"
                      onClick={() => onAct(step.action)}
                    >
                      {step.cta}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onAct(step.action)}
                className="press flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <StepMark done={step.done} />
                <span
                  className={cn(
                    "min-w-0 flex-1 text-sm font-bold",
                    step.done ? "text-text-tertiary line-through" : "text-text-primary",
                  )}
                >
                  {step.title}
                </span>
                <ChevronRight className="size-4 shrink-0 text-text-tertiary" aria-hidden />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StepMark({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
        done ? "border-accent bg-accent/20 text-accent-ink" : "border-divider text-transparent",
      )}
    >
      <Check className="size-3" />
    </span>
  );
}
