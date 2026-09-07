import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { registerDeviceToken, registerDeviceTokenInput } from "@/lib/push.server";

/**
 * Thin wrapper over the shared `registerDeviceToken` (PRD §6.6 "Token
 * lifecycle"): register or refresh the caller's push token. Idempotent —
 * the app calls this after every permission grant and whenever APNs
 * rotates the token, so a repeat with the same token is just a refresh.
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
      idempotent: true,
      handler: async ({ ctx, input }) => {
        const { userId, supabase } = requireContext(ctx);
        return registerDeviceToken({ userId, supabase }, input);
      },
    }),
  },
});
