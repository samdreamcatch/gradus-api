import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { restoreFoundingCoachTierRoute } from "@/lib/api/founding-routes";

/**
 * Thin wrapper over the shared `restoreFoundingCoachTier` (PRD §3.7, §6.8,
 * Appendix A "Billing"): cancels the coach's paid subscription immediately
 * and restores the free Founding Coach tier. Options live in
 * `src/lib/api/founding-routes.ts` so the pipeline is testable with a fake
 * admin and a stubbed Stripe client.
 */
export const Route = createFileRoute("/api/v1/coach/founding/restore")({
  server: {
    handlers: defineApiRoute(restoreFoundingCoachTierRoute()),
  },
});
