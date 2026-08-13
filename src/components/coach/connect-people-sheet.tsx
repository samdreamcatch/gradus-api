import { useState } from "react";
import { ChevronLeft, ChevronRight, KeyRound, Link2, Share2 } from "lucide-react";
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
import { InviteCard } from "@/components/onboarding/invite-card";
import { EnterInviteCodeCard } from "@/components/coach/enter-invite-code-card";
import { SegmentedToggle } from "@/components/plans/segmented-toggle";

type Step = "hub" | "share" | "code";

const STEPS: {
  key: Exclude<Step, "hub">;
  title: string;
  description: string;
  icon: typeof Share2;
}[] = [
  {
    key: "share",
    title: "Invite a parent or athlete",
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
 * Coach-side "Connect" hub — mirrors the parent/athlete "Add a coach" drawer.
 * Opens to a two-row menu, then swaps in the chosen step with a back arrow.
 */
export function ConnectPeopleSheet() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("hub");
  const [audience, setAudience] = useState<"parents" | "adult-athletes">("parents");
  const vv = useVisualViewport();

  const active = STEPS.find((s) => s.key === step);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setStep("hub");
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Link2 className="size-3.5" aria-hidden /> Connect
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
              <SheetTitle>Connect</SheetTitle>
              <SheetDescription>Two ways to connect.</SheetDescription>
            </SheetHeader>
            <div className="mt-4 overflow-hidden rounded-xl border border-divider bg-elevated">
              {STEPS.map((s, i) => {
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
                <SheetTitle className="min-w-0 flex-1">{active?.title}</SheetTitle>
              </div>
              <SheetDescription className="sr-only">{active?.description}</SheetDescription>
            </SheetHeader>
            <div className="mt-4">
              {step === "share" ? (
                <div className="space-y-3">
                  <SegmentedToggle
                    value={audience}
                    onChange={setAudience}
                    options={[
                      { key: "parents", label: "Youth parents" },
                      { key: "adult-athletes", label: "Adult (18+)" },
                    ]}
                  />
                  <InviteCard compact audience={audience} />
                </div>
              ) : (
                <EnterInviteCodeCard hideIntro onSuccess={() => setOpen(false)} />
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
