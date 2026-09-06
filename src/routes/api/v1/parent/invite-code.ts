import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { codeResponseSchema } from "@/lib/api/signup-schema";
import { getOrCreateParentInviteCode } from "@/lib/parent-signup.server";

/** Thin wrapper over the shared `getOrCreateParentInviteCode`: the code a coach uses to join the parent's athletes. */
export const Route = createFileRoute("/api/v1/parent/invite-code")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/parent/invite-code",
      auth: "user",
      summary: "The parent's shareable invite code",
      output: codeResponseSchema,
      handler: async ({ ctx }) => {
        const { userId, admin } = requireContext(ctx);
        return getOrCreateParentInviteCode({ userId, admin });
      },
    }),
  },
});
