import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { completeVerificationResultSchema } from "@/lib/api/guardian-verification-schema";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  completeVerificationFromRedirect,
  completeVerificationInput,
} from "@/lib/guardian-verification.server";

/**
 * Thin wrapper over the shared `completeVerificationFromRedirect` (PRD §6.13
 * A2): the iOS app forwards the signed query from the `/verified` universal
 * link. Public because the HMAC over `status:externalPayload` is the trust
 * anchor and the parent may not be signed in on the device that opened the
 * email; the transaction id makes a replay a no-op.
 */
export const Route = createFileRoute("/api/v1/guardian/verification/complete")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/guardian/verification/complete",
      operationId: "completeParentVerification",
      auth: "public",
      summary: "Record a KWS Verification Response (the signed /verified redirect)",
      input: completeVerificationInput,
      output: completeVerificationResultSchema,
      rateLimit: { windowSeconds: 60, max: 30 },
      handler: async ({ input }) => completeVerificationFromRedirect(supabaseAdmin, input),
    }),
  },
});
