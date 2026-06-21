import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Timer, X } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import {
  getPendingLessonWrapUps,
  recordLessonWrapUp,
  type PendingWrapUp,
} from "@/lib/lesson-wrap-ups.functions";
import { createPlan } from "@/lib/plans.functions";

function nowParts() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return {
    lessonDate: `${yyyy}-${mm}-${dd}`,
    dayOfWeek: d.getDay(),
    currentMinute: d.getHours() * 60 + d.getMinutes(),
  };
}

function formatTime(minute: number) {
  const h24 = Math.floor(minute / 60);
  const m = minute % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function LessonWrapUpProvider() {
  const [tick, setTick] = useState(() => nowParts());
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Re-derive every 60s so the prompt fires the moment a slot's end time passes.
  useEffect(() => {
    const id = setInterval(() => setTick(nowParts()), 60_000);
    return () => clearInterval(id);
  }, []);

  const fetchPending = useServerFn(getPendingLessonWrapUps);
  const { data: pending = [] } = useQuery({
    queryKey: ["lesson-wrap-ups", tick.lessonDate, tick.dayOfWeek, tick.currentMinute],
    queryFn: () => fetchPending({ data: tick }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    // Quietly empty for non-coach users (server returns []).
  });

  // Track which athletes we've already shown the modal for in this session,
  // so the modal doesn't keep re-popping after the user dismisses it.
  const seenRef = useRef<Set<string>>(new Set());
  const [modalFor, setModalFor] = useState<PendingWrapUp | null>(null);

  useEffect(() => {
    if (modalFor) return;
    const next = pending.find((p) => !seenRef.current.has(p.athleteId));
    if (next) {
      seenRef.current.add(next.athleteId);
      setModalFor(next);
    }
  }, [pending, modalFor]);

  // List drawer for the banner when more than one is pending.
  const [listOpen, setListOpen] = useState(false);

  const recordFn = useServerFn(recordLessonWrapUp);
  const recordMutation = useMutation({
    mutationFn: recordFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lesson-wrap-ups"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createPlanFn = useServerFn(createPlan);
  const createPlanMutation = useMutation({
    mutationFn: createPlanFn,
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleEdit(wrapUp: PendingWrapUp) {
    // Mark handled first so the banner clears immediately.
    await recordMutation.mutateAsync({
      data: { athleteId: wrapUp.athleteId, lessonDate: wrapUp.lessonDate, action: "edited" },
    });
    setModalFor(null);
    setListOpen(false);
    if (wrapUp.activePlanId) {
      navigate({ to: "/coach/plans/$planId", params: { planId: wrapUp.activePlanId } });
    } else {
      const created = await createPlanMutation.mutateAsync({
        data: { kind: "plan", athleteId: wrapUp.athleteId },
      });
      navigate({
        to: "/coach/plans/$planId",
        params: { planId: created.id },
        search: { from: "plus" },
      });
    }
  }

  function handleRedeploy(wrapUp: PendingWrapUp) {
    recordMutation.mutate({
      data: { athleteId: wrapUp.athleteId, lessonDate: wrapUp.lessonDate, action: "redeployed" },
    });
    setModalFor(null);
    if (pending.length <= 1) setListOpen(false);
  }

  function handleDismissModal() {
    // Don't write a dismissal row — banner should persist until the coach acts.
    setModalFor(null);
  }

  const bannerCount = pending.length;
  useBottomBannerLock(bannerCount > 0 && !modalFor);

  const bannerLabel = useMemo(() => {
    if (bannerCount === 0) return "";
    if (bannerCount === 1) return `Wrap up ${pending[0].athleteName}'s lesson`;
    return `Wrap up ${bannerCount} lessons`;
  }, [pending, bannerCount]);

  return (
    <>
      {/* Banner — fixed above the coach bottom nav (which is h-16ish + safe area) */}
      {bannerCount > 0 && !modalFor ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-[calc(env(safe-area-inset-bottom)+72px)]">
          <div className="pointer-events-auto mx-3 flex w-full max-w-3xl items-center gap-2 rounded-full border border-foreground/15 bg-popover px-3 py-2 shadow-page">
            <button
              type="button"
              onClick={() => {
                if (bannerCount === 1) {
                  seenRef.current.add(pending[0].athleteId);
                  setModalFor(pending[0]);
                } else {
                  setListOpen(true);
                }
              }}
              className="flex flex-1 items-center gap-2 text-left"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
                <Timer className="h-4 w-4" />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-sm font-bold text-text-primary">{bannerLabel}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
                  Tap to wrap up
                </span>
              </span>
            </button>
            {bannerCount === 1 ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs font-bold"
                onClick={() => handleRedeploy(pending[0])}
                disabled={recordMutation.isPending}
              >
                Re-deploy
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Modal */}
      <AlertDialog
        open={!!modalFor}
        onOpenChange={(open) => {
          if (!open) handleDismissModal();
        }}
      >
        <AlertDialogContent>
          {modalFor ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{modalFor.athleteName}'s lesson just ended.</AlertDialogTitle>
                <AlertDialogDescription>
                  Ended at {formatTime(modalFor.lessonEndMinute)}. Want to update her practice plan,
                  or re-deploy the current one?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="gap-2 sm:gap-2">
                <AlertDialogCancel
                  onClick={handleDismissModal}
                  className="sm:mr-auto"
                >
                  Not now
                </AlertDialogCancel>
                <Button
                  variant="outline"
                  onClick={() => handleRedeploy(modalFor)}
                  disabled={recordMutation.isPending}
                >
                  Re-deploy
                </Button>
                <AlertDialogAction
                  onClick={() => handleEdit(modalFor)}
                  disabled={recordMutation.isPending || createPlanMutation.isPending}
                >
                  Edit plan
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>

      {/* List drawer for multi-pending */}
      <AlertDialog open={listOpen} onOpenChange={setListOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lessons to wrap up</AlertDialogTitle>
            <AlertDialogDescription>
              Pick an athlete to update their plan, or re-deploy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="divide-y divide-divider">
            {pending.map((p) => (
              <li key={p.athleteId} className="flex items-center gap-2 py-2">
                <div className="flex-1">
                  <div className="text-sm font-bold text-text-primary">{p.athleteName}</div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
                    Ended {formatTime(p.lessonEndMinute)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs font-bold"
                  onClick={() => handleRedeploy(p)}
                  disabled={recordMutation.isPending}
                >
                  Re-deploy
                </Button>
                <Button
                  size="sm"
                  className="h-8 px-3 text-xs font-bold"
                  onClick={() => handleEdit(p)}
                  disabled={recordMutation.isPending || createPlanMutation.isPending}
                >
                  Edit
                </Button>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <X className="mr-1 h-3.5 w-3.5" />
              Close
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
