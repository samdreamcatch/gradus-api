import { createFileRoute } from "@tanstack/react-router";

// Index match for /coach/plans — the list is rendered by the parent layout
// (coach.plans.tsx). This component is intentionally empty so that the
// $planId route can render an overlay sheet on top of the list without
// duplicating the list.
export const Route = createFileRoute("/_authenticated/coach/plans/")({
  component: () => null,
});
