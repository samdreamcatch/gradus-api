import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Check, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getOrCreateParentInviteCode } from "@/lib/parent-signup.functions";

/**
 * Card the parent uses to invite their coach(es). Shows a shareable URL and
 * the underlying 8-character code, both copy-to-clipboard. No coach-side
 * email/SMS send — the parent shares the link themselves.
 */
export function InviteCoachCard() {
  const fetchCode = useServerFn(getOrCreateParentInviteCode);
  const { data, isLoading, error } = useQuery({
    queryKey: ["parent-invite-code"],
    queryFn: () => fetchCode(),
  });

  const [linkCopied, setLinkCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const code = data?.code;
  const url = code
    ? `${typeof window !== "undefined" ? window.location.origin : "https://gradus.training"}/signup/coach?invite=${code}`
    : "";

  const copy = async (text: string, kind: "link" | "code") => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (kind === "link") {
        setLinkCopied(true);
        toast.success("Link copied — paste it to your coach");
        setTimeout(() => setLinkCopied(false), 1800);
      } else {
        setCodeCopied(true);
        toast.success("Code copied");
        setTimeout(() => setCodeCopied(false), 1800);
      }
    } catch {
      toast.error("Couldn't copy — try selecting it manually");
    }
  };

  return (
    <div className="rounded-2xl bg-card p-6 shadow-card">
      <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
        Bring your coach in
      </p>
      <h2 className="mt-2 font-display text-2xl text-text-primary">
        Invite your coach
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        Share the link below — when your coach signs up, they'll be linked to
        your athletes, sports, goals, and lesson times automatically.
      </p>

      <div className="mt-5 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <div
            aria-label="Shareable signup link"
            className="flex-1 truncate rounded-md border border-divider bg-elevated px-4 py-3 text-sm text-text-primary"
          >
            {isLoading || !url ? (
              <span className="text-text-tertiary">Generating link…</span>
            ) : (
              url
            )}
          </div>
          <Button
            type="button"
            variant="default"
            onClick={() => copy(url, "link")}
            disabled={!url}
            className="shrink-0"
          >
            {linkCopied ? (
              <>
                <Check className="size-4" aria-hidden /> Copied
              </>
            ) : (
              <>
                <LinkIcon className="size-4" aria-hidden /> Copy link
              </>
            )}
          </Button>
        </div>

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
            onClick={() => copy(code ?? "", "code")}
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
        Already have a coach on Gradus? They can paste this code on their
        roster page to claim your account.
      </p>

      {error && (
        <p className="mt-3 text-xs text-destructive">{(error as Error).message}</p>
      )}
    </div>
  );
}
