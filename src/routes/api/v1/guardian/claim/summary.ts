import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { guardianClaimSummarySchema } from "@/lib/api/guardian-schema";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGuardianClaimSummary, getGuardianClaimSummaryInput } from "@/lib/guardian-claim.server";

/**
 * Thin wrapper over the shared `getGuardianClaimSummary` — what the `/g/:token`
 * claim page shows before sign-in (PRD §3.5, Appendix A "Guardians"). Public;
 * the token travels in the body, never the URL. Throttled per IP by the route
 * limiter (30/min, fails closed when the limiter is degraded). It does NOT
 * consume the shared `record_invite_lookup_attempt` window `/invites/resolve`
 * uses, so parents opening claim links behind one network never lock out
 * invite-code entry there. The token is never part of a rate-limit key.
 */
export const Route = createFileRoute("/api/v1/guardian/claim/summary")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/guardian/claim/summary",
      operationId: "getGuardianClaimSummary",
      auth: "public",
      summary: "Who a guardian claim link is for, and whether it is still open",
      input: getGuardianClaimSummaryInput,
      output: guardianClaimSummarySchema,
      rateLimit: { windowSeconds: 60, max: 30 },
      handler: async ({ input }) => getGuardianClaimSummary(supabaseAdmin, input),
    }),
  },
});
