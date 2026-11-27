import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { publicOrigin } from "@/lib/api/public-origin";
import {
  startIdentityVerification,
  verificationStartSchema,
} from "@/lib/coach-verification.server";

/** After a failed or unfinished check: a fresh Stripe Identity session (the last one is ignored). */
export const Route = createFileRoute("/api/v1/marketplace/seller/verification/retry")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/marketplace/seller/verification/retry",
      operationId: "retrySellerVerification",
      auth: "user",
      summary: "Start identity verification again after a failed or unfinished check",
      output: verificationStartSchema,
      handler: async ({ ctx, request }) => {
        const { userId, admin } = requireContext(ctx);
        return startIdentityVerification(
          { userId, admin },
          { returnUrl: `${publicOrigin(request)}/verification/complete` },
        );
      },
    }),
  },
});
