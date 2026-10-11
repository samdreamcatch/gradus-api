import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { registerDeviceToken, registerDeviceTokenInput } from "@/lib/push.server";

/**
 * Thin wrapper over the shared `registerDeviceToken` (PRD §6.6 "Token
 * lifecycle"): register or refresh the caller's push token. Idempotent by
 * itself — the app calls this after every permission grant, every sign-in
 * and whenever APNs rotates the token, and the upsert on the token makes a
 * repeat just a refresh.
 *
 * Deliberately NOT `idempotent: true`: the app sends `Idempotency-Key:
 * device-<token>`, which is the same on every call from one install. With
 * replay on, signing out (`DELETE /devices/{token}` removes the row) and
 * back in within 24 hours replayed the stored 200 without running the
 * upsert, so that account had no token and never got a push. The header is
 * ignored here; the handler always runs.
 */
export const Route = createFileRoute("/api/v1/devices/")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/devices",
      operationId: "registerDevice",
      auth: "user",
      summary: "Register (or refresh) the caller's push token",
      input: registerDeviceTokenInput,
      output: okSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase } = requireContext(ctx);
        return registerDeviceToken({ userId, supabase }, input);
      },
    }),
  },
});
