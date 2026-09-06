import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { inviteCodeResponseSchema } from "@/lib/api/onboarding-schema";
import { rotateCoachInviteCode } from "@/lib/invites.server";

/** Thin wrapper over the shared `rotateCoachInviteCode`: a new code; links carrying the old one stop working. */
export const Route = createFileRoute("/api/v1/coach/invite-code/rotate")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/invite-code/rotate",
      auth: "user",
      summary: "Replace the coach's invite code",
      output: inviteCodeResponseSchema,
      handler: async ({ ctx }) => {
        const { userId, supabase } = requireContext(ctx);
        return rotateCoachInviteCode({ userId, supabase });
      },
    }),
  },
});
