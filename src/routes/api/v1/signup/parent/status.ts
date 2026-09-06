import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { parentSignupStatusSchema } from "@/lib/api/signup-schema";
import { getParentSignupStatus } from "@/lib/parent-signup.server";

/** Thin wrapper over the shared `getParentSignupStatus`: where the parent is in sign-up, to resume the wizard. */
export const Route = createFileRoute("/api/v1/signup/parent/status")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/signup/parent/status",
      auth: "user",
      summary: "Parent sign-up progress",
      output: parentSignupStatusSchema,
      handler: async ({ ctx }) => {
        const { userId, admin } = requireContext(ctx);
        return getParentSignupStatus({ userId, admin });
      },
    }),
  },
});
