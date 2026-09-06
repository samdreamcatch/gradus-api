import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { claimOrganizationResultSchema } from "@/lib/api/onboarding-schema";
import { claimOrganizationInviteCode, orgCodeSchema } from "@/lib/orgs.server";

const inputSchema = z.object({ code: orgCodeSchema });

/** Thin wrapper over the shared `claimOrganizationInviteCode`: join a club during onboarding (no Stripe involved yet). Idempotent. */
export const Route = createFileRoute("/api/v1/orgs/claim-code")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/orgs/claim-code",
      auth: "user",
      idempotent: true,
      summary: "Join a club with its invite code",
      input: inputSchema,
      output: claimOrganizationResultSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return claimOrganizationInviteCode({ userId, supabase, admin }, input.code);
      },
    }),
  },
});
