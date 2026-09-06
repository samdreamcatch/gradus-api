import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { startParentSignupResultSchema } from "@/lib/api/signup-schema";
import { startParentSignup, startParentSignupInput } from "@/lib/parent-signup.server";

/** Thin wrapper over the shared `startParentSignup` (PRD §7.1 "Parent sign-up", step 1): the parent's name and optional coach code. */
export const Route = createFileRoute("/api/v1/signup/parent/start")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/signup/parent/start",
      auth: "user",
      summary: "Create or update the parent profile",
      input: startParentSignupInput,
      output: startParentSignupResultSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return startParentSignup({ userId, admin }, input);
      },
    }),
  },
});
