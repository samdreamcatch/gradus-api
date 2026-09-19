import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Mic, Loader2, X, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useVoiceCapture } from "@/hooks/use-voice-capture";
import { voiceBuildPlan } from "@/lib/voice.functions";
import type { VoiceSources } from "@/lib/voice-types";
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
      transcript?: string;
      sources?: VoiceSources;
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
      if (result.aiFailed) {
        toast.error(
          mode === "create"
            ? "We couldn't turn that dictation into a plan. Your words are saved on the plan — open it to add moves, or try again."
            : "We couldn't turn that dictation into changes. Your words are saved on the plan — try again, or edit by hand.",
        );
      } else if (result.appliedMoveCount === 0) {
        toast.warning(
          mode === "create"
            ? "Couldn't pick out moves from that — your dictation is saved on the plan so you can add moves manually."
            : "Couldn't pick out moves from that — your dictation is saved on the plan.",
        );
      } else {
        const dropped = result.droppedMoveCount ?? 0;
        const base =
          mode === "create" ? `New plan from voice · ${moveLabel}` : `Updated · ${moveLabel}`;
        if (dropped > 0) {
          toast.warning(
            `${base} · ${dropped === 1 ? "one move we couldn't read was skipped" : `${dropped} moves we couldn't read were skipped`}`,
          );
        } else {
          toast.success(base);
        }
      }

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
      <Mic className={cn(variant === "fab" ? "h-7 w-7" : "h-5 w-5")} strokeWidth={2.5} />
    ) : (
      <Mic className={cn(variant === "fab" ? "h-7 w-7" : "h-5 w-5")} strokeWidth={2.5} />
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
          ? "fixed bottom-44 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-page ring-1 ring-black/10 transition active:scale-95 disabled:opacity-60 touch-none select-none"
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
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/60 backdrop-blur-sm sm:items-center">
          <div
            role="dialog"
            aria-live="polite"
            className="relative mx-4 mb-24 w-full max-w-md rounded-3xl border border-divider bg-card px-6 py-4 shadow-page sm:mb-0"
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
                  state === "processing" ? "bg-elevated" : "bg-accent text-accent-foreground",
                )}
                style={
                  state === "recording"
                    ? {
                        boxShadow: `0 0 0 ${Math.round(level * 14)}px color-mix(in oklab, var(--accent) 25%, transparent)`,
                      }
                    : undefined
                }
              >
                {state === "processing" ? (
                  <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
                ) : (
                  <Mic className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-hand text-2xl leading-none text-text-primary">
                  {state === "recording" ? "Listening…" : "Organizing your plan…"}
                </div>
                {state === "recording" ? (
                  <div className="mt-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
                    <Waveform level={level} />
                    <span className="font-mono normal-case tracking-normal text-text-secondary">
                      {formatElapsed(elapsedMs)}
                    </span>
                  </div>
                ) : (
                  <div className="mt-2 text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
                    Transcribing & parsing with AI
                  </div>
                )}
              </div>
              {state === "recording" ? (
                <button
                  type="button"
                  onClick={cancel}
                  className="rounded-full p-2 text-text-tertiary hover:bg-elevated hover:text-text-primary"
                  aria-label="Cancel"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            {state === "recording" ? (
              <div className="mt-5 rounded-2xl bg-elevated/60 p-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
                  Try saying
                </div>
                <ul className="mt-2 space-y-1.5 font-hand text-lg leading-snug text-text-primary">
                  {(mode === "create" ? CREATE_PROMPTS : EDIT_PROMPTS).map((p) => (
                    <li key={p} className="flex gap-2">
                      <span className="text-accent-ink">›</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="text-[11px] font-medium text-text-tertiary">
                    Hold the mic, or tap stop when done.
                  </div>
                  <button
                    type="button"
                    onClick={stop}
                    className="rounded-full bg-accent px-4 py-1.5 text-[11px] font-black uppercase tracking-widest text-accent-foreground shadow-sm active:scale-95"
                  >
                    Stop & organize
                  </button>
                </div>
              </div>
            ) : null}

            {elapsedMs > 165_000 && state === "recording" ? (
              <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-destructive">
                <AlertCircle className="h-3 w-3" />
                <span>Wrapping up at 3 min</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

const CREATE_PROMPTS = [
  "Your athlete's name",
  "The moves you want them to work on",
  "Why you're assigning this now",
];

const EDIT_PROMPTS = ["Edits to a specific move", "Add or remove a move", "Update notes and cues "];

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
