import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { ApiError } from "@/lib/api/errors";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { unregisterLiveActivityToken } from "@/lib/live-activities.server";

function tokenParam(raw: string): string {
  const token = z.string().min(8).max(512).safeParse(raw);
  if (!token.success) {
    throw new ApiError({
      code: "validation_failed",
      status: 400,
      message: "Invalid Live Activity token.",
    });
  }
  return token.data;
}

/** Drop a Live Activity token (sign-out, or the activity ended). Deleting nothing is still a 200. */
export const Route = createFileRoute("/api/v1/live-activities/tokens/$token")({
  server: {
    handlers: defineApiRoute({
      method: "DELETE",
      path: "/api/v1/live-activities/tokens/{token}",
      operationId: "unregisterLiveActivityToken",
      auth: "user",
      summary: "Drop a Live Activity push token",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { userId, admin } = requireContext(ctx);
        return unregisterLiveActivityToken({ userId, admin }, tokenParam(params.token));
      },
    }),
  },
});
