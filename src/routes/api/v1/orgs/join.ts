import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { joinOrganizationResultSchema } from "@/lib/api/onboarding-schema";
import { joinOrganization, joinOrganizationInput } from "@/lib/orgs.server";

/**
 * Thin wrapper over the shared `joinOrganization`: a signed-up coach moves
 * onto a club-covered plan; any Stripe subscription is wound down first
 * and the org link is written only when that succeeds. Idempotent.
 */
export const Route = createFileRoute("/api/v1/orgs/join")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/orgs/join",
      auth: "user",
      idempotent: true,
      summary: "Join a club from Settings",
      input: joinOrganizationInput,
      output: joinOrganizationResultSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return joinOrganization({ userId, supabase, admin }, input);
      },
    }),
  },
});
