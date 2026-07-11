import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ShareInviteButton } from "@/components/share/share-invite-button";
import { useCoachInvite } from "@/hooks/use-coach-invite";

interface InviteCardProps {
  /** When true, render only the code chip + share/copy (no headline). */
  compact?: boolean;
}

export function InviteCard({ compact = false }: InviteCardProps) {
  const { data, isLoading, error } = useCoachInvite();
  const [copied, setCopied] = useState(false);

  const code = data?.code;
  const url = code
    ? `${typeof window !== "undefined" ? window.location.origin : "https://gradus.training"}/signup/parent?invite=${code}`
    : "";

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

  const controls = (
    <div className="space-y-3">
      <ShareInviteButton
        url={url}
        title="Join me on Gradus"
        text="I'm your coach on Gradus — tap to set up your parent account and we'll be connected."
        label={isLoading ? "Generating link…" : "Share invite"}
        disabled={isLoading || !url}
        className="w-full"
      />
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <div
          aria-label="Your parent invite code"
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
    </div>
  );

  if (compact) {
    return (
      <div>
        {controls}
        {error && (
          <p className="mt-2 text-xs text-destructive">{(error as Error).message}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      {controls}
      <p className="mt-3 font-hand text-lg text-accent-ink whitespace-pre-wrap">
        Share this with parents to add their athlete to your roster.{"\n\n"}
        Find your code any time in settings.
      </p>

      {error && (
        <p className="mt-2 text-xs text-destructive">{(error as Error).message}</p>
      )}
    </div>
  );
}
