import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { IdleSlide, RunningPill } from "@/components/plans/session-timer-controls";
import {
  submitAthletePlanSession,
  submitPlanSession,
  type PlanSessionLogDTO,
} from "@/lib/plan-sessions.functions";

import {
  useActiveSession,
  useLiveElapsedMs,
  type ActiveSessionRole,
} from "@/lib/active-session-store";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { SessionFeedbackModal, type FeedbackMove } from "@/components/plans/session-feedback-modal";

export function PlanSessionTimer({
  role,
  planId,
  coachFirstName,
  athleteFirstName,
  planTitle,
  feedbackMoves,
}: {
  role: ActiveSessionRole;
  planId: string;
  coachFirstName: string;
  athleteFirstName: string;
  planTitle: string;
  /** The plan's moves when the coach asked for feedback on each move. */
  feedbackMoves?: FeedbackMove[];
}) {
  const { session, start, pause, resume, clear } = useActiveSession();
  const elapsedMs = useLiveElapsedMs(250);
  const [showFeedback, setShowFeedback] = useState(false);

  const queryClient = useQueryClient();
  const submitFn = useServerFn(role === "parent" ? submitPlanSession : submitAthletePlanSession);
  const submitMutation = useMutation({
    mutationFn: submitFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plan-sessions", planId] });
      queryClient.invalidateQueries({ queryKey: ["plan-session-log", planId] });
      queryClient.invalidateQueries({ queryKey: ["parent-plan", planId] });
      queryClient.invalidateQueries({ queryKey: ["parent-plans"] });
      queryClient.invalidateQueries({ queryKey: ["athlete-plan", planId] });
      queryClient.invalidateQueries({ queryKey: ["athlete-plans"] });
      queryClient.invalidateQueries({ queryKey: ["coach-plans"] });
    },
  });

  const ownsActive = session?.planId === planId;
  const otherActive = session && !ownsActive;
  const running = !!(ownsActive && session.startedAt != null);

  // Keep the screen awake whenever this device is actively running a session.
  useWakeLock(running);

  // If something else cleared the active session (e.g. another tab), close any
  // open feedback modal so we don't leave a stale dialog up.
  useEffect(() => {
    if (!session && showFeedback) setShowFeedback(false);
  }, [session, showFeedback]);

  const totalSec = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  const started = ownsActive && (running || elapsedMs > 0);

  /** Nudge (never block) when the other party just logged this same plan. */
  const warnIfRecentlyLoggedByOther = () => {
    const log = queryClient.getQueryData<PlanSessionLogDTO>(["plan-session-log", planId]);
    const latest = log?.sessions[0];
    if (!latest) return;
    const viewerKind: "parent" | "athlete" = role === "parent" ? "parent" : "athlete";
    if (latest.loggedByKind === viewerKind) return;
    const hoursAgo = (Date.now() - new Date(latest.loggedAt).getTime()) / 3_600_000;
    if (hoursAgo > 2) return;
    toast("Already logged recently", {
      description: `${latest.loggedByFirstName} logged a session for this plan in the last couple of hours.`,
    });
  };

  const handleStart = () => {
    if (otherActive) {
      toast("You already have a session running", {
        description: `Return to "${session!.planTitle}" to finish it first.`,
      });
      return;
    }
    warnIfRecentlyLoggedByOther();
    start({ role, planId, planTitle, coachFirstName, athleteFirstName });
  };

  const handleTogglePause = () => {
    if (!ownsActive) return;
    if (running) pause();
    else resume();
  };

  const handleEnd = () => {
    if (!ownsActive) return;
    pause();
    setShowFeedback(true);
  };

  const handleDiscard = () => {
    if (!ownsActive) return;
    clear();
  };

  const closeFeedback = () => {
    setShowFeedback(false);
    clear();
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
        viewerIsAthlete={role !== "parent"}
        moves={feedbackMoves}
        onSubmit={async (payload) => {
          try {
            await submitMutation.mutateAsync({
              data: {
                planId,
                ...(payload.moveRatings
                  ? { moveRatings: payload.moveRatings }
                  : { stateIndex: payload.stateIndex ?? undefined }),
                note: payload.note,
                durationSeconds: totalSec,
              },
            });
            toast(`Sent to Coach ${coachFirstName}`, {
              description:
                role === "parent"
                  ? `${athleteFirstName} · ${payload.stateLabel}`
                  : `Your session · ${payload.stateLabel}`,
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
