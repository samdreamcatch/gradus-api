import { useState } from "react";
import { ChevronLeft, ChevronRight, KeyRound, Plus, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { cn } from "@/lib/utils";
import { InviteCoachCard } from "./invite-coach-card";
import { AddCoachByCodeCard } from "./add-coach-by-code-card";

type Athlete = { id: string; firstName: string; lastName: string };

type Step = "hub" | "share" | "code";

const STEPS: {
  key: Exclude<Step, "hub">;
  title: string;
  description: string;
  icon: typeof Share2;
}[] = [
  {
    key: "share",
    title: "Invite your coach",
    description: "Share a link or code",
    icon: Share2,
  },
  {
    key: "code",
    title: "Enter their code",
    description: "They're already on Gradus",
    icon: KeyRound,
  },
];

/**
 * "Add a coach" hub — mirrors the coach-side "Add an athlete" drawer. Opens
 * to a two-row menu, then swaps in the chosen step with a back arrow so the
 * parent (or adult athlete) sees one focused thing at a time.
 */
export function ConnectCoachSheet({
  athletes = [],
  audience = "parent",
}: {
  /** Parent's athletes — used by the code step. Empty for adult athletes. */
  athletes?: Athlete[];
  audience?: "parent" | "adult-athlete";
}) {
  const isAdultAthlete = audience === "adult-athlete";
  // Adult athletes only have the share path, so there's nothing to choose
  // between — the sheet opens straight into it with no hub or back arrow.
  const steps = isAdultAthlete ? STEPS.filter((s) => s.key === "share") : STEPS;
  const initialStep: Step = steps.length === 1 ? steps[0].key : "hub";

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(initialStep);
  const vv = useVisualViewport();

  const active = STEPS.find((s) => s.key === step);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setStep(initialStep);
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Plus className="size-3.5" aria-hidden /> Add a coach
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="paper-surface overflow-y-auto"
        style={{ bottom: vv.keyboardInset, maxHeight: Math.round(vv.height * 0.9) }}
      >
        {step === "hub" ? (
          <>
            <SheetHeader>
              <SheetTitle>Add a coach</SheetTitle>
              <SheetDescription>
                {steps.length > 1 ? "Two ways to connect." : "Send them an invite."}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 overflow-hidden rounded-xl border border-divider bg-elevated">
              {steps.map((s, i) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStep(s.key)}
                    className={cn(
                      "press flex w-full items-center gap-3 px-4 py-4 text-left",
                      i > 0 && "border-t border-divider",
                    )}
                  >
                    <Icon className="size-5 shrink-0 text-accent-ink" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-text-primary">{s.title}</span>
                      <span className="mt-0.5 block text-xs text-text-secondary">
                        {s.description}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-text-tertiary" aria-hidden />
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                {initialStep === "hub" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Back"
                    onClick={() => setStep("hub")}
                    className="-ml-2 shrink-0"
                  >
                    <ChevronLeft className="size-5" aria-hidden />
                  </Button>
                )}
                <SheetTitle className="min-w-0 flex-1">{active?.title}</SheetTitle>
              </div>
              <SheetDescription className="sr-only">{active?.description}</SheetDescription>
            </SheetHeader>
            <div className="mt-4">
              {step === "share" ? (
                <InviteCoachCard audience={audience} compact />
              ) : (
                <AddCoachByCodeCard
                  athletes={athletes}
                  hideChrome
                  onSuccess={() => setOpen(false)}
                  onCancel={() => setStep(initialStep)}
                />
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
