import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { publicOrigin } from "@/lib/api/public-origin";
import {
  getMyVerification,
  startIdentityVerification,
  verificationStartSchema,
  verificationStateSchema,
} from "@/lib/coach-verification.server";

/**
 * The coach's marketplace verification (src/lib/coach-verification.server.ts).
 * GET: where it stands (asks Stripe about an open session first).
 * POST: opens a Stripe Identity check (ID plus a matching selfie) and answers
 * its hosted page in `startURL`; Stripe returns to `/verification/complete`,
 * which reopens the app.
 */
export const Route = createFileRoute("/api/v1/marketplace/seller/verification/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/marketplace/seller/verification",
        operationId: "getSellerVerification",
        auth: "user",
        summary: "The coach's identity and SafeSport verification",
        output: verificationStateSchema,
        handler: async ({ ctx }) => {
          const { userId, admin } = requireContext(ctx);
          return getMyVerification({ userId, admin });
        },
      }),
      ...defineApiRoute({
        method: "POST",
        path: "/api/v1/marketplace/seller/verification",
        operationId: "startSellerVerification",
        auth: "user",
        summary: "Start identity verification (Stripe Identity: ID and selfie); Coach Pro only",
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
  },
});
