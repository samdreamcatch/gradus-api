import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { shareTokenSchema } from "@/lib/api/plans-schema";
import { getOrCreateShareToken } from "@/lib/plan-share.server";

/** Thin wrapper over the shared `getOrCreateShareToken` (PRD §7.3 "Plan sharing"): the permanent token behind `/p/{token}`. Idempotent. */
export const Route = createFileRoute("/api/v1/plans/$id/share-token")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/plans/{id}/share-token",
      operationId: "createPlanShareToken",
      auth: "user",
      summary: "Get or create a plan's share token",
      output: shareTokenSchema,
      handler: async ({ ctx, params }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return getOrCreateShareToken({ userId, supabase, admin }, z.string().uuid().parse(params.id));
      },
    }),
  },
});
