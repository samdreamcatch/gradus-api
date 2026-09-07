import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { ApiError } from "@/lib/api/errors";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { unregisterDeviceToken } from "@/lib/push.server";

function tokenParam(raw: string): string {
  const token = z.string().min(8).max(512).safeParse(raw);
  if (!token.success) {
    throw new ApiError({
      code: "validation_failed",
      status: 400,
      message: "Invalid device token.",
    });
  }
  return token.data;
}

/**
 * Thin wrapper over the shared `unregisterDeviceToken` (PRD §6.6 "Token
 * lifecycle"): drop a device registration on sign-out or when push is
 * turned off. A token that was already removed (or never registered) is
 * still a 200 — deleting nothing is not an error.
 */
export const Route = createFileRoute("/api/v1/devices/$token")({
  server: {
    handlers: defineApiRoute({
      method: "DELETE",
      path: "/api/v1/devices/{token}",
      operationId: "unregisterDevice",
      auth: "user",
      summary: "Drop a device's push registration",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { userId, supabase } = requireContext(ctx);
        return unregisterDeviceToken({ userId, supabase }, tokenParam(params.token));
      },
    }),
  },
});
