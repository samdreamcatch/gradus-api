import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { inviteCodeResponseSchema } from "@/lib/api/onboarding-schema";
import { getCoachInviteCode } from "@/lib/invites.server";

/** Thin wrapper over the shared `getCoachInviteCode`: the coach's persistent 8-character code, created on first use. */
export const Route = createFileRoute("/api/v1/coach/invite-code/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/invite-code",
      auth: "user",
      summary: "The coach's shareable invite code",
      output: inviteCodeResponseSchema,
      handler: async ({ ctx }) => {
        const { userId, supabase } = requireContext(ctx);
        return getCoachInviteCode({ userId, supabase });
      },
    }),
  },
});
