import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ShareInviteButton } from "@/components/share/share-invite-button";
import { getOrCreateParentInviteCode } from "@/lib/parent-signup.functions";
import { getOrCreateAdultAthleteInviteCode } from "@/lib/adult-athlete-invite.functions";

type Audience = "parent" | "adult-athlete";

interface InviteCoachCardProps {
  /** Which audience is inviting their coach. Defaults to "parent". */
  audience?: Audience;
  /**
   * Bare layout for use inside a sheet step — drops the card chrome and
   * heading, and shortens the intro to a single line.
   */
  compact?: boolean;
}

const COPY: Record<
  Audience,
  {
    intro: string;
    shortIntro: string;
    shareText: string;
    codeAria: string;
    alreadyOn: string;
  }
> = {
  parent: {
    intro:
      "Tap share — when your coach signs up they'll be linked to your athletes, sports, goals, and lesson times automatically, or they can add the code directly in their settings.\u00a0",
    shortIntro:
      "When your coach signs up they'll be linked to your athletes, sports, goals, and lesson times automatically.",
    shareText: "Join me on Gradus so we can share practice plans and messages.",
    codeAria: "Your parent invite code",
    alreadyOn:
      "Is your coach already on Gradus? They can paste this code on their roster page to link up to you and your athlete.",
  },
  "adult-athlete": {
    intro:
      "Tap share — when your coach signs up they'll be linked to you, your sports, goals, and lesson times automatically.",
    shortIntro:
      "When your coach signs up they'll be linked to you, your sports, goals, and lesson times automatically.",
    shareText: "Join me on Gradus so we can share practice plans and messages.",
    codeAria: "Your athlete invite code",
    alreadyOn:
      "Is your coach already on Gradus? They can paste this code on their roster page to link up to you.",
  },
};

/**
 * Card the parent (or adult athlete) uses to invite their coach(es). Primary
 * CTA opens the native share sheet with a code-embedded link so the coach
 * lands on the signup page pre-linked. The raw code stays visible for
 * coaches who are already on Gradus and want to paste it on their roster
 * page.
 */
export function InviteCoachCard({ audience = "parent", compact = false }: InviteCoachCardProps) {
  const parentFn = useServerFn(getOrCreateParentInviteCode);
  const adultAthleteFn = useServerFn(getOrCreateAdultAthleteInviteCode);
  const isAdultAthlete = audience === "adult-athlete";
  const { data, isLoading, error } = useQuery({
    queryKey: isAdultAthlete ? ["adult-athlete-invite-code"] : ["parent-invite-code"],
    queryFn: () => (isAdultAthlete ? adultAthleteFn() : parentFn()),
  });

  const [codeCopied, setCodeCopied] = useState(false);

  const code = data?.code;
  const url = code
    ? `${typeof window !== "undefined" ? window.location.origin : "https://gradus.training"}/i/${code}`
    : "";

  const copy = COPY[audience];

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
    <div className={compact ? "" : "rounded-2xl bg-card p-6 shadow-card"}>
      {!compact && (
        <h2 className="mt-2 font-display text-2xl text-text-primary">Invite your coach</h2>
      )}
      <p className={compact ? "text-sm text-text-secondary" : "mt-2 text-sm text-text-secondary"}>
        {compact ? copy.shortIntro : copy.intro}
      </p>

      <div className="mt-5 space-y-3">
        <ShareInviteButton
          url={url}
          title="Invite your coach to Gradus"
          text={copy.shareText}
          label={isLoading ? "Generating link…" : "Share invite"}
          disabled={isLoading || !url}
          className="w-full"
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <div
            aria-label={copy.codeAria}
            className="flex-1 rounded-md border border-divider bg-elevated px-4 py-3 text-center font-mono text-xl tracking-[0.25em] text-text-primary"
          >
            {isLoading || !code ? <span className="text-text-tertiary">········</span> : code}
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

      {error && <p className="mt-3 text-xs text-destructive">{(error as Error).message}</p>}
    </div>
  );
}
