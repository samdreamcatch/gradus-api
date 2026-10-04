import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import {
  registerAppTransactionInputSchema,
  registerAppTransactionResultSchema,
} from "@/lib/api/app-store-schema";
import { registerAppTransaction } from "@/lib/app-store-notifications.server";

/**
 * Thin wrapper over the shared `registerAppTransaction` (PRD §6.13 B4, S3):
 * the iOS app sends `AppTransaction.shared`'s signed JWS for an athlete
 * session, so a later App Store `RESCIND_CONSENT` for that download can find
 * the athlete. Coaches and parents answer `bound: false`. 422
 * `invalid_app_transaction` when the JWS does not verify against Apple.
 */
export const Route = createFileRoute("/api/v1/me/app-transaction")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/me/app-transaction",
      operationId: "registerAppTransaction",
      auth: "user",
      summary: "Bind the signed-in athlete to this device's App Store download",
      input: registerAppTransactionInputSchema,
      output: registerAppTransactionResultSchema,
      rateLimit: { windowSeconds: 3600, max: 20 },
      handler: async ({ ctx, input }) => {
        const { admin, userId } = requireContext(ctx);
        return registerAppTransaction(admin, userId, input);
      },
    }),
  },
});
