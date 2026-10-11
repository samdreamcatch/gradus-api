import { useId } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AI_DRAFTED_NOTE, DRAFT_HINT_MAX } from "@/lib/move-draft";

/** "Draft with AI" for a new move (PRD decision #53); the caller decides what it fills. */
export function DraftWithAiButton({
  disabled,
  pending,
  onClick,
}: {
  disabled: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled || pending}
      className="gap-1.5"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Sparkles className="h-4 w-4" aria-hidden />
      )}
      {pending ? "Drafting…" : "Draft with AI"}
    </Button>
  );
}

/** Shown under a field the AI filled, until the coach edits it. */
export function AiDraftedNote({ text = AI_DRAFTED_NOTE }: { text?: string }) {
  return (
    <p className="mt-1 flex items-center gap-1 text-xs font-bold text-text-secondary">
      <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
      {text}
    </p>
  );
}

/**
 * When Gradus doesn't recognise a move (decision #53): nothing was filled,
 * so say so in place, and take a few words about the move for another try.
 * A live region, so screen readers hear the outcome without a toast.
 */
export function UnrecognisedMove({
  message,
  hint,
  pending,
  onHintChange,
  onDraftAgain,
}: {
  message: string;
  hint: string;
  pending: boolean;
  onHintChange: (hint: string) => void;
  onDraftAgain: () => void;
}) {
  const hintId = useId();
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-2 rounded-md border border-divider bg-card p-3"
    >
      <p className="text-sm text-text-primary">{message}</p>
      <label htmlFor={hintId} className="mt-2 block text-xs font-bold text-text-secondary">
        A few words about this move
      </label>
      <Input
        id={hintId}
        value={hint}
        maxLength={DRAFT_HINT_MAX}
        placeholder="e.g. a backward entry into a sit spin"
        onChange={(e) => onHintChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hint.trim() && !pending) {
            e.preventDefault();
            onDraftAgain();
          }
        }}
        className="mt-1"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onDraftAgain}
        disabled={!hint.trim() || pending}
        className="mt-2 gap-1.5"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="h-4 w-4" aria-hidden />
        )}
        {pending ? "Drafting…" : "Draft again"}
      </Button>
    </div>
  );
}
