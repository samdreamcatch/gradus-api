import { useState } from "react";
import { Copy, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useCoachInvite, useRotateCoachInvite } from "@/hooks/use-coach-invite";

interface InviteCardProps {
  /** When true, render only the code chip + copy button (no headline/rotate). */
  compact?: boolean;
}

export function InviteCard({ compact = false }: InviteCardProps) {
  const { data, isLoading, error } = useCoachInvite();
  const rotate = useRotateCoachInvite();
  const [copied, setCopied] = useState(false);

  const code = data?.code;

  const handleCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Code copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy — try selecting it manually");
    }
  };

  const handleRotate = async () => {
    try {
      await rotate.mutateAsync();
      toast.success("New code generated. The old code no longer works.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't rotate code");
    }
  };

  const chip = (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
      <div
        aria-label="Your invite code"
        className="flex-1 rounded-md border border-divider bg-elevated px-5 py-4 text-center font-mono text-2xl tracking-[0.25em] text-text-primary sm:text-3xl"
      >
        {isLoading || !code ? (
          <span className="text-text-tertiary">········</span>
        ) : (
          code
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={handleCopy}
        disabled={!code}
        className="shrink-0"
      >
        {copied ? (
          <>
            <Check className="size-4" aria-hidden /> Copied
          </>
        ) : (
          <>
            <Copy className="size-4" aria-hidden /> Copy code
          </>
        )}
      </Button>
    </div>
  );

  if (compact) {
    return (
      <div>
        {chip}
        {error && (
          <p className="mt-2 text-xs text-destructive">{(error as Error).message}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      {chip}
      <p className="mt-3 font-hand text-lg text-accent-ink">
        Share this with parents to add their athlete to your roster.
      </p>

      <div className="mt-6 flex items-center justify-between border-t border-divider/60 pt-4">
        <p className="text-xs uppercase tracking-wider text-text-secondary">
          Lost or shared too widely?
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!code || rotate.isPending}
            >
              <RefreshCw className="size-4" aria-hidden />
              {rotate.isPending ? "Generating…" : "Generate a new code"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Generate a new invite code?</AlertDialogTitle>
              <AlertDialogDescription>
                The current code will stop working immediately. Anyone you've
                already shared it with will need the new code to join.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleRotate}>
                Generate new code
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {error && (
        <p className="mt-2 text-xs text-destructive">{(error as Error).message}</p>
      )}
    </div>
  );
}
