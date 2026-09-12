import { useState } from "react";

import { HelpBubble } from "@/components/coach/help-bubble";
import { ChecklistBody, type Step } from "@/components/coach/getting-started-checklist";

/**
 * Shown on the coach plans page when the coach has no plans at all. Reuses the
 * getting-started thought bubble, anchored under the plan type picker.
 */
export function PlanHelpBubble({
  onCreatePlan,
  onOpenLibrary,
}: {
  onCreatePlan: () => void;
  onOpenLibrary: () => void;
}) {
  const [open, setOpen] = useState(true);

  const steps: Step[] = [
    {
      key: "create",
      title: "Start a new plan",
      description: "Tap the + button to open a blank plan and give it a title.",
      cta: "Create a plan",
      done: false,
      action: onCreatePlan,
    },
    {
      key: "moves",
      title: "Add moves from your library",
      description: "Pick moves, set reps or time, and order them for the session.",
      cta: "Open move library",
      done: false,
      action: onOpenLibrary,
    },
    {
      key: "share",
      title: "Assign it and activate",
      description: "Choose an athlete, then activate so they can see and log it.",
      cta: "Create a plan",
      done: false,
      action: onCreatePlan,
    },
  ];

  return (
    <div className="flex flex-col items-start">
      <HelpBubble
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        title="How to make a plan"
        side="top-left"
        openLabel="How to make a plan"
        closeLabel="Minimize how to make a plan"
      >
        <ChecklistBody steps={steps} currentKey="create" onAct={(fn) => fn()} />
      </HelpBubble>
    </div>
  );
}
