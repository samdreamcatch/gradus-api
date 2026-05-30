import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Mic, Loader2, X, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useVoiceCapture } from "@/hooks/use-voice-capture";
import { voiceBuildPlan } from "@/lib/voice.functions";
import { stashVoiceTouched } from "@/lib/voice-touched-store";

export interface VoiceFabProps {
  mode: "create" | "edit";
  /** Required when mode === "edit". */
  planId?: string;
  /**
   * Fired on success. In edit mode, used to seed the diff-highlight state
   * inside the plan editor.
   */
  onVoiceApplied?: (result: {
    planId: string;
    transcript: string;
    touched: {
      plan: { title?: boolean; athleteId?: boolean; notes?: boolean };
      moves: Record<string, string[]>;
      newMoveIds: string[];
    };
    unresolvedAthleteName: string | null;
    appliedMoveCount: number;
  }) => void;
  /** Visual variant — `fab` is the big bottom-right circle, `inline` is a small icon button. */
  variant?: "fab" | "inline";
  className?: string;
}

const formatElapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function VoiceFab({
  mode,
  planId,
  onVoiceApplied,
  variant = "fab",
  className,
}: VoiceFabProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const voiceFn = useServerFn(voiceBuildPlan);
  const pointerActiveRef = useRef(false);

  const handleCapture = useCallback(
    async (blob: Blob) => {
      const form = new FormData();
      form.append("audio", blob, "voice.webm");
      form.append("mode", mode);
      if (mode === "edit" && planId) form.append("planId", planId);

      // useServerFn supports passing FormData as the request body via `data`.
      const result = (await voiceFn({ data: form as unknown as never })) as Awaited<
        ReturnType<typeof voiceBuildPlan>
      >;

      qc.invalidateQueries({ queryKey: ["plans"] });
      qc.invalidateQueries({ queryKey: ["plan", result.planId] });

      const moveLabel =
        result.appliedMoveCount === 1 ? "1 move" : `${result.appliedMoveCount} moves`;
      toast.success(
        mode === "create" ? `New plan from voice · ${moveLabel}` : `Updated · ${moveLabel}`,
      );

      if (result.unresolvedAthleteName) {
        toast.warning(`Couldn't find "${result.unresolvedAthleteName}" in your roster`);
      }

      onVoiceApplied?.(result);

      if (mode === "create") {
        stashVoiceTouched(result.planId, result.touched);
        navigate({
          to: "/coach/plans/$planId",
          params: { planId: result.planId },
        });
      }
    },
    [mode, planId, voiceFn, qc, navigate, onVoiceApplied],
  );

  const { state, level, elapsedMs, errorMsg, start, stop, cancel, reset } = useVoiceCapture({
    onCapture: handleCapture,
  });

  // Surface errors via toast
  useEffect(() => {
    if (state === "error" && errorMsg) {
      toast.error(errorMsg);
      reset();
    }
  }, [state, errorMsg, reset]);

  const isBusy = state === "recording" || state === "processing";
  const showOverlay = state === "recording" || state === "processing";

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (state === "processing") return;
    e.preventDefault();
    pointerActiveRef.current = true;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    void start();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointerActiveRef.current) return;
    pointerActiveRef.current = false;
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
    if (state === "recording") stop();
  };
  const onPointerCancel = () => {
    if (!pointerActiveRef.current) return;
    pointerActiveRef.current = false;
    cancel();
  };

  const buttonContent =
    state === "processing" ? (
      <Loader2 className={cn("animate-spin", variant === "fab" ? "h-7 w-7" : "h-5 w-5")} />
    ) : state === "recording" ? (
      <Mic
        className={cn(variant === "fab" ? "h-7 w-7" : "h-5 w-5")}
        strokeWidth={2.5}
      />
    ) : (
      <Mic
        className={cn(variant === "fab" ? "h-7 w-7" : "h-5 w-5")}
        strokeWidth={2.5}
      />
    );

  const button = (
    <button
      type="button"
      disabled={state === "processing"}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={mode === "create" ? "Hold to dictate a new plan" : "Hold to add to plan by voice"}
      className={cn(
        variant === "fab"
          ? "fixed bottom-44 right-5 z-30 flex h-16 w-16 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-page ring-1 ring-black/10 transition active:scale-95 disabled:opacity-60 touch-none select-none"
          : "inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-sm ring-1 ring-black/10 transition active:scale-95 disabled:opacity-60 touch-none select-none",
        state === "recording" && "animate-pulse",
        className,
      )}
      style={
        state === "recording"
          ? {
              boxShadow: `0 0 0 ${Math.round(level * 18)}px color-mix(in oklab, var(--accent) 30%, transparent), 0 10px 30px -10px color-mix(in oklab, var(--accent) 50%, transparent)`,
            }
          : undefined
      }
    >
      {buttonContent}
    </button>
  );

  return (
    <>
      {button}
      {showOverlay ? (
        <div className="fixed inset-x-0 bottom-0 z-40 pointer-events-none">
          <div className="mx-auto mb-4 max-w-sm rounded-2xl border border-divider bg-card/95 px-4 py-3 shadow-page backdrop-blur pointer-events-auto">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  state === "processing" ? "bg-elevated" : "bg-accent text-accent-foreground",
                )}
              >
                {state === "processing" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-hand text-lg leading-none text-text-primary">
                  {state === "recording" ? "Listening…" : "Organizing your plan…"}
                </div>
                {state === "recording" ? (
                  <div className="mt-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
                    <Waveform level={level} />
                    <span className="font-mono normal-case tracking-normal text-text-secondary">
                      {formatElapsed(elapsedMs)}
                    </span>
                  </div>
                ) : (
                  <div className="mt-1 text-[11px] font-medium text-text-tertiary">
                    Transcribing & parsing with AI
                  </div>
                )}
              </div>
              {state === "recording" ? (
                <button
                  type="button"
                  onClick={cancel}
                  className="rounded-full p-1.5 text-text-tertiary hover:bg-elevated hover:text-text-primary"
                  aria-label="Cancel"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            {elapsedMs > 75_000 && state === "recording" ? (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-destructive">
                <AlertCircle className="h-3 w-3" />
                <span>Wrapping up at 90 s</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function Waveform({ level }: { level: number }) {
  // 7 bars whose heights are a smoothed function of `level`
  const bars = Array.from({ length: 7 }, (_, i) => {
    const phase = (i - 3) / 3;
    const h = Math.max(0.15, level * (1 - 0.35 * phase * phase));
    return h;
  });
  return (
    <div className="flex h-3 items-end gap-0.5">
      {bars.map((h, i) => (
        <span
          key={i}
          className="w-0.5 rounded-full bg-accent-ink"
          style={{ height: `${Math.round(h * 100)}%` }}
        />
      ))}
    </div>
  );
}
