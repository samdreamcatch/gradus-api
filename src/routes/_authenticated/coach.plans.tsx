import { createFileRoute } from "@tanstack/react-router";
import { CoachBottomNav } from "@/components/coach/bottom-nav";

export const Route = createFileRoute("/_authenticated/coach/plans")({
  component: PlansPage,
});

function PlansPage() {
  return (
    <>
      <div className="mx-auto min-h-dvh max-w-3xl px-4 pt-12 pb-32">
        <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
          Coach
        </p>
        <h1 className="mt-2 text-4xl">
          <span className="pen-highlight">Plans</span>
        </h1>
        <p className="mt-4 text-sm text-text-secondary">
          Ready for your instructions.
        </p>
      </div>
      <CoachBottomNav />
    </>
  );
}
