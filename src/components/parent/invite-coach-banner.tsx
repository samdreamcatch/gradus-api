import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Copy, Check, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ShareInviteButton } from "@/components/share/share-invite-button";
import { getOrCreateParentInviteCode } from "@/lib/parent-signup.functions";

/**
 * Slim app-wide banner shown on every /parent/* route until the parent has
 * linked at least one coach. Expands inline to reveal the share button and
 * 8-char code. Intentionally non-dismissible — disappears the moment a coach
 * is linked.
 */
export function InviteCoachBanner() {
  const fetchCode = useServerFn(getOrCreateParentInviteCode);
  const { data } = useQuery({
    queryKey: ["parent-invite-code"],
    queryFn: () => fetchCode(),
  });
  const [open, setOpen] = useState(false);
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
    <div className="border-b border-divider bg-card">
      <div className="mx-auto max-w-2xl px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 rounded-md py-1 text-left"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
            <UserPlus className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
            <span className="font-medium">Invite your coach</span>
            <span className="ml-1 text-text-secondary">to receive practice plans</span>
          </span>
          <ChevronDown
            className={`size-4 shrink-0 text-text-secondary transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>

        {open && (
          <div className="mt-3 space-y-2 pb-2">
            <p className="text-xs text-text-secondary">
              Tap share — when your coach signs up they'll be linked to your athletes, sports,
              goals, and lesson times automatically.
            </p>
            <ShareInviteButton
              url={url}
              title="Invite your coach to Gradus"
              text="Join me on Gradus so we can share practice plans and messages."
              size="sm"
              disabled={!url}
              className="w-full"
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <div
                aria-label="Your parent invite code"
                className="flex-1 rounded-md border border-divider bg-elevated px-3 py-2 text-center font-mono text-base tracking-[0.25em] text-text-primary"
              >
                {code || <span className="text-text-tertiary">········</span>}
              </div>
              <Button
                type="button"
                size="sm"
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
            <p className="text-xs text-text-secondary">
              Is your coach already on Gradus? They can paste this code on their roster page to link
              up to you and your athlete.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
