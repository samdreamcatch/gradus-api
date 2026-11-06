import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { getParentChecklist, parentChecklistSteps } from "@/lib/parent-checklist.functions";
import { HelpBubble } from "@/components/coach/help-bubble";
import { ChecklistBody, type Step } from "@/components/coach/getting-started-checklist";
import { InviteCoachCard } from "@/components/parent/invite-coach-card";
import { ParentVerificationStep } from "@/components/consent/parent-verification-step";

export const parentChecklistQueryKey = ["parent", "getting-started"] as const;

function storageKey(parentId: string) {
  return `gradus.parentChecklist.${parentId}`;
}

type Stored = { seen?: boolean; minimized?: boolean };

function readStored(parentId: string): Stored {
  try {
    const raw = localStorage.getItem(storageKey(parentId));
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}

function writeStored(parentId: string, next: Stored) {
  try {
    localStorage.setItem(
      storageKey(parentId),
      JSON.stringify({ ...readStored(parentId), ...next }),
    );
  } catch {
    /* ignore */
  }
}

type SheetKind = "verify" | "connect" | null;

/**
 * The parent's "Get set up" helper, the counterpart to `CoachGettingStarted`:
 * confirm you're an adult (when KWS applies), connect with your coach, add
 * your athlete and set goals together. Progress comes from real data, so a
 * step ticks itself off wherever the parent did it. Opens as the anchored
 * thought bubble, minimizes into the pill, and is gone for good once every
 * step is done. The verify and connect steps open in a sheet right here;
 * goals go to Settings, where athletes and their goals live.
 */
export function ParentGettingStarted() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data } = useQuery({
    queryKey: parentChecklistQueryKey,
    queryFn: () => getParentChecklist(),
    staleTime: 30_000,
  });

  const [minimized, setMinimized] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const parentId = data?.parentId ?? null;

  useEffect(() => {
    if (!parentId) return;
    const stored = readStored(parentId);
    setMinimized(Boolean(stored.minimized));
    if (!stored.seen) {
      writeStored(parentId, { seen: true });
    }
  }, [parentId]);

  // Coming back from Settings (goals, a linked coach) or a claim: re-read progress.
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: parentChecklistQueryKey });
  }, [pathname, qc]);

  useEffect(() => {
    if (minimized || sheet) return;

    const minimizeNow = () => {
      setMinimized(true);
      if (parentId) writeStored(parentId, { minimized: true });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (bubbleRef.current?.contains(event.target as Node)) return;
      minimizeNow();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") minimizeNow();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [minimized, parentId, sheet]);

  const steps = useMemo<Step[]>(() => {
    if (!data) return [];
    const hasAthlete = data.athleteCount > 0;
    const copy: Record<"verify" | "coach" | "goals", Omit<Step, "key" | "done">> = {
      verify: {
        title: "Confirm you're an adult",
        description:
          "A one-time check with our partner Kids Web Services before you connect a coach or open a conversation for an athlete under 18.",
        cta: "Verify now",
        action: () => setSheet("verify"),
      },
      coach: {
        title: "Connect with your coach",
        description:
          "Share your invite code so your coach links to your athlete, or enter their code if they're already on Gradus.",
        cta: "Connect my coach",
        action: () => setSheet("connect"),
      },
      goals: {
        title: hasAthlete ? "Set goals together" : "Add your athlete and set goals",
        description: hasAthlete
          ? "Pick each athlete's current level and season goal with your coach. Practice plans build from them."
          : "Add your athlete, then pick a current level and season goal with your coach.",
        cta: hasAthlete ? "Set goals" : "Add an athlete",
        action: () => navigate({ to: "/parent/settings" }),
      },
    };
    return parentChecklistSteps(data).map((s) => ({ key: s.key, done: s.done, ...copy[s.key] }));
  }, [data, navigate]);

  const doneCount = steps.filter((s) => s.done).length;
  const remaining = steps.length - doneCount;
  const allDone = steps.length > 0 && remaining === 0;
  const currentKey = steps.find((s) => !s.done)?.key ?? null;

  const minimize = () => {
    setMinimized(true);
    if (parentId) writeStored(parentId, { minimized: true });
  };

  const restore = () => {
    setMinimized(false);
    if (parentId) writeStored(parentId, { minimized: false });
  };

  const closeSheet = () => {
    setSheet(null);
    void qc.invalidateQueries({ queryKey: parentChecklistQueryKey });
  };

  if (!data || !parentId || allDone) return null;

  return (
    <>
      <div
        ref={bubbleRef}
        className="fixed right-4 bottom-24 z-30 flex max-w-[calc(100vw-2rem)] flex-col items-end"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <HelpBubble
          open={!minimized}
          onOpen={restore}
          onClose={minimize}
          title="Get set up"
          meta={`${doneCount} / ${steps.length}`}
          badge={remaining}
          openLabel={`Get set up — ${remaining} ${remaining === 1 ? "step" : "steps"} left`}
          closeLabel="Minimize getting started"
        >
          <ChecklistBody
            steps={steps}
            currentKey={currentKey}
            onAct={(fn) => {
              minimize();
              fn();
            }}
          />
        </HelpBubble>
      </div>

      <VerifySheet open={sheet === "verify"} onClose={closeSheet} />
      <ConnectCoachSheet
        open={sheet === "connect"}
        onClose={closeSheet}
        onEnterCode={() => {
          closeSheet();
          void navigate({ to: "/parent/settings" });
        }}
      />
    </>
  );
}

/** The adult-verification step in a sheet, so the parent never leaves the page. */
function VerifySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const vv = useVisualViewport();
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        className="paper-surface overflow-y-auto"
        style={{ bottom: vv.keyboardInset, maxHeight: Math.round(vv.height * 0.9) }}
      >
        <SheetHeader>
          <SheetTitle>Confirm you're an adult</SheetTitle>
          <SheetDescription>A one-time check, done on our partner's secure page.</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {open ? <ParentVerificationStep optional onVerified={onClose} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * "Connect with your coach": the share card the parent home already shows,
 * plus the way in for a coach who is already on Gradus (their code, entered
 * on the athlete's Coaches row in Settings).
 */
function ConnectCoachSheet({
  open,
  onClose,
  onEnterCode,
}: {
  open: boolean;
  onClose: () => void;
  onEnterCode: () => void;
}) {
  const vv = useVisualViewport();
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        className="paper-surface overflow-y-auto"
        style={{ bottom: vv.keyboardInset, maxHeight: Math.round(vv.height * 0.9) }}
      >
        <SheetHeader>
          <SheetTitle>Connect with your coach</SheetTitle>
          <SheetDescription>Share a link or code.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-5">
          {open ? <InviteCoachCard compact /> : null}
          <div className="border-t border-divider pt-4">
            <p className="text-sm text-text-secondary">
              Is your coach already on Gradus? Enter their code on your athlete's Coaches row.
            </p>
            <Button type="button" variant="outline" className="mt-3 gap-1.5" onClick={onEnterCode}>
              <KeyRound className="size-4" aria-hidden /> Enter their code
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
