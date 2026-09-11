import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { claimFoundingCoachTierRoute } from "@/lib/api/founding-routes";

/**
 * Thin wrapper over the shared `claimFoundingCoachTier` (PRD §3.6, §6.8,
 * Appendix A "Billing"): grants a founding coach the free Coach tier without
 * a checkout. Options live in `src/lib/api/founding-routes.ts` so the
 * pipeline is testable with a fake admin.
 */
export const Route = createFileRoute("/api/v1/coach/founding/claim")({
  server: {
    handlers: defineApiRoute(claimFoundingCoachTierRoute()),
  },
});
