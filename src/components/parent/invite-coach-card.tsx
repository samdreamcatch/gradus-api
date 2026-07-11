import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ShareInviteButton } from "@/components/share/share-invite-button";
import { getOrCreateParentInviteCode } from "@/lib/parent-signup.functions";

/**
 * Card the parent uses to invite their coach(es). Primary CTA opens the
 * native share sheet with a code-embedded link so the coach lands on the
 * signup page pre-linked. The raw code stays visible for coaches who are
 * already on Gradus and want to paste it on their roster page.
 */
export function InviteCoachCard() {
  const fetchCode = useServerFn(getOrCreateParentInviteCode);
  const { data, isLoading, error } = useQuery({
    queryKey: ["parent-invite-code"],
    queryFn: () => fetchCode(),
  });

  const [codeCopied, setCodeCopied] = useState(false);

  const code = data?.code;
  const url = code
    ? `${typeof window !== "undefined" ? window.location.origin : "https://gradus.training"}/i/${code}`
    : "";

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCodeCopied(true);
      toast.success("Code copied");
      setTimeout(() => setCodeCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy — try selecting it manually");
    }
  };

  return (
    <div className="rounded-2xl bg-card p-6 shadow-card">
      <h2 className="mt-2 font-display text-2xl text-text-primary">
        Invite your coach
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        Tap share — when your coach signs up they'll be linked to your
        athletes, sports, goals, and lesson times automatically.
      </p>

      <div className="mt-5 space-y-3">
        <ShareInviteButton
          url={url}
          title="Invite your coach to Gradus"
          text="Join me on Gradus so we can share practice plans and messages."
          label={isLoading ? "Generating link…" : "Share invite"}
          disabled={isLoading || !url}
          className="w-full"
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <div
            aria-label="Your parent invite code"
            className="flex-1 rounded-md border border-divider bg-elevated px-4 py-3 text-center font-mono text-xl tracking-[0.25em] text-text-primary"
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
            onClick={copyCode}
            disabled={!code}
            className="shrink-0"
          >
            {codeCopied ? (
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

      <p className="mt-4 font-hand text-lg text-accent-ink">
        Is your coach already on Gradus? They can paste this code on their
        roster page to link up to you and your athlete.
      </p>

      {error && (
        <p className="mt-3 text-xs text-destructive">{(error as Error).message}</p>
      )}
    </div>
  );
}
