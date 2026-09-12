import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { getCoachChecklist } from "@/lib/coach-checklist.functions";
import { useVisualViewport } from "@/hooks/use-visual-viewport";

export const coachChecklistQueryKey = ["coach", "getting-started"] as const;

type StepKey = "schedule" | "invite" | "plan";

function storageKey(coachId: string) {
  return `gradus.coachChecklist.${coachId}`;
}

type Stored = { seen?: boolean; dismissed?: boolean };

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
 * Three-step getting-started checklist for new coaches. It pops up as a bottom
 * sheet the first time a coach reaches the roster, then lives as a compact card
 * until every step is done or the coach dismisses it. Progress is derived from
 * real data, so a step ticks itself off wherever the coach did it.
 */
export function CoachGettingStarted({
  onStartSchedule,
  onStartInvite,
}: {
  onStartSchedule: () => void;
  onStartInvite: () => void;
}) {
  const navigate = useNavigate();
  const vv = useVisualViewport();
  const { data } = useQuery({
    queryKey: coachChecklistQueryKey,
    queryFn: () => getCoachChecklist(),
    staleTime: 30_000,
  });

  const [dismissed, setDismissed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const coachId = data?.coachId ?? null;

  useEffect(() => {
    if (!coachId) return;
    const stored = readStored(coachId);
    if (stored.dismissed) {
      setDismissed(true);
      return;
    }
    if (!stored.seen) {
      setSheetOpen(true);
      writeStored(coachId, { seen: true });
    }
  }, [coachId]);

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
  const allDone = steps.length > 0 && doneCount === steps.length;
  const currentKey = steps.find((s) => !s.done)?.key ?? null;

  const dismiss = () => {
    setDismissed(true);
    setSheetOpen(false);
    if (coachId) writeStored(coachId, { dismissed: true });
  };

  if (!data || !coachId || allDone || dismissed) return null;

  const body = (
    <ChecklistBody
      steps={steps}
      currentKey={currentKey}
      onAct={(fn) => {
        setSheetOpen(false);
        fn();
      }}
    />
  );

  return (
    <>
      <Card variant="row" className="mt-4 p-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Eyebrow as="h2" size="caption" tone="tertiary">
              Get set up
            </Eyebrow>
            <span className="text-xs text-text-tertiary">
              {doneCount} / {steps.length} steps
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Dismiss getting started"
            onClick={dismiss}
            className="-mr-2 shrink-0"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        <div className="border-t border-divider">{body}</div>
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          className="paper-surface overflow-y-auto"
          style={{ bottom: vv.keyboardInset, maxHeight: Math.round(vv.height * 0.9) }}
        >
          <SheetHeader>
            <SheetTitle>Get set up</SheetTitle>
            <SheetDescription>
              Three steps to get your athletes training in Gradus.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 overflow-hidden rounded-2xl border border-divider bg-elevated">
            {body}
          </div>
          <div className="mt-3 flex justify-center">
            <Button type="button" variant="ghost" size="sm" onClick={() => setSheetOpen(false)}>
              I'll do this later
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

type Step = {
  key: StepKey;
  title: string;
  description: string;
  cta: string;
  done: boolean;
  action: () => void;
};

function ChecklistBody({
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
