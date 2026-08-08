import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useActiveSession, useLiveElapsedMs } from "@/lib/active-session-store";

/**
 * Sticky pill that appears on every authenticated page while a session is
 * running. Tap to return to the plan page where the full timer controls
 * (pause / discard / end) live. Hidden when on the originating plan page.
 */
export function ActiveSessionBar() {
  const { session } = useActiveSession();
  const elapsedMs = useLiveElapsedMs(1000);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (!session) return null;

  const routePattern =
    session.role === "parent" ? "/parent/plans/$planId" : "/athlete/plans/$planId";
  const resolvedPath =
    session.role === "parent"
      ? `/parent/plans/${session.planId}`
      : `/athlete/plans/${session.planId}`;

  // Don't render the floating bar on the plan's own page — the inline
  // RunningPill already shows the timer there.
  if (pathname === resolvedPath) return null;

  // The session belongs to an athlete/parent context. Coaches can't
  // resolve it from their own routes, so don't show the return pill
  // while browsing the coach app.
  if (pathname.startsWith("/coach")) return null;

  const totalSec = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  const running = session.startedAt != null;

  return (
    <div className="sticky top-2 z-40 mx-auto mt-2 flex max-w-2xl px-3">
      <button
        type="button"
        onClick={() => navigate({ to: routePattern, params: { planId: session.planId } })}
        className="group flex w-full items-center gap-2 rounded-full border border-attention/50 bg-attention/15 px-3 py-1.5 text-attention-ink shadow-card backdrop-blur"
      >
        {running ? (
          <span className="relative inline-flex size-2 shrink-0">
            <span className="absolute inset-0 animate-ping rounded-full bg-attention opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-attention" />
          </span>
        ) : (
          <span className="inline-flex size-2 shrink-0 rounded-full bg-attention/60" />
        )}
        <span className="tabular-nums text-sm font-bold">
          {running ? "" : "Paused · "}
          {mm}:{ss}
        </span>
        <span className="mx-1 h-3 w-px shrink-0 bg-attention-ink/30" />
        <span className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold">
          {session.planTitle}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-black uppercase tracking-widest">
          Return
          <ArrowRight className="size-3.5" />
        </span>
      </button>
    </div>
  );
}
