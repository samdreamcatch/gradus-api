import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { coachBillingSchema } from "@/lib/api/billing-schema";
import { getCoachBilling } from "@/lib/coach-billing.server";
import { coachContext } from "@/lib/coach-onboarding.server";

/**
 * Thin wrapper over the shared `getCoachBilling` (PRD §6.8, Appendix A
 * "Billing"): the coach's entitlement, tier, dates, and the web manage link.
 * Display only — the app never sells. No ETag: some fields come from Stripe.
 * A non-coach answers 403 `wrong_role` without a coach row being created.
 */
export const Route = createFileRoute("/api/v1/coach/billing")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/billing",
      operationId: "getCoachBilling",
      auth: "user",
      summary: "The coach's billing summary (display only)",
      output: coachBillingSchema,
      handler: async ({ ctx }) => getCoachBilling(coachContext(requireContext(ctx))),
    }),
  },
});
