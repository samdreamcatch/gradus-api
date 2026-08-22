import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, CreditCard, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { claimGuardianInvite } from "@/lib/team-guardians.functions";

/**
 * Hub → detail sheet for parents not yet on a Team plan: either redeem an
 * invite code another parent shared, or start their own team (checkout).
 */
export function JoinTeamSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const vv = useVisualViewport();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const claim = useServerFn(claimGuardianInvite);

  const [step, setStep] = useState<"hub" | "code">("hub");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setStep("hub");
      setCode("");
    }
  };

  const handleJoin = async () => {
    setBusy(true);
    try {
      await claim({ data: { code: code.trim() } });
      toast.success("You've been added as a guardian.");
      setCode("");
      handleOpenChange(false);
      void qc.invalidateQueries();
      void navigate({ to: "/parent/settings" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't accept that invite.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="paper-surface overflow-y-auto"
        style={{ bottom: vv.keyboardInset, maxHeight: Math.round(vv.height * 0.9) }}
      >
        <SheetHeader>
          <SheetTitle>{step === "hub" ? "Join or start a team" : "Enter your invite code"}</SheetTitle>
          <SheetDescription>
            {step === "hub"
              ? "A team lets up to 3 parents or guardians share an athlete — and lets their coaches see each other's plans."
              : "Enter the code another parent shared to join their athlete."}
          </SheetDescription>
        </SheetHeader>

        {step === "hub" ? (
          <div className="mt-4 space-y-2">
            <button
              type="button"
              onClick={() => setStep("code")}
              className="press flex w-full items-start gap-3 rounded-xl border border-divider bg-elevated p-3 text-left"
            >
              <KeyRound className="mt-0.5 size-5 shrink-0 text-text-secondary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-text-primary">
                  I have an invite code
                </span>
                <span className="mt-0.5 block text-xs text-text-tertiary">
                  Another parent already started a team for your athlete.
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                handleOpenChange(false);
                void navigate({ to: "/parent/team", search: {} });
              }}
              className="press flex w-full items-start gap-3 rounded-xl border border-divider bg-elevated p-3 text-left"
            >
              <CreditCard className="mt-0.5 size-5 shrink-0 text-text-secondary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-text-primary">Start a team</span>
                <span className="mt-0.5 block text-xs text-text-tertiary">
                  Choose monthly or yearly and invite your co-parents.
                </span>
              </span>
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="team-invite-code">Invite code</Label>
              <Input
                id="team-invite-code"
                placeholder="Invite code"
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="font-mono"
              />
            </div>
            <Button
              type="button"
              className="w-full"
              disabled={busy || code.trim().length < 4}
              onClick={() => void handleJoin()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Join"}
            </Button>
            <button
              type="button"
              onClick={() => setStep("hub")}
              className="press inline-flex items-center gap-1 text-sm text-text-secondary"
            >
              <ArrowLeft className="size-4" aria-hidden /> Back
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
