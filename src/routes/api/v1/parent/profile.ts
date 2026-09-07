import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { parentProfileInput, updateParentProfile } from "@/lib/parent-settings.server";

/** Thin wrapper over the shared `updateParentProfile` (PRD §7.7): the parent's own name. */
export const Route = createFileRoute("/api/v1/parent/profile")({
  server: {
    handlers: defineApiRoute({
      method: "PATCH",
      path: "/api/v1/parent/profile",
      operationId: "updateParentProfile",
      auth: "user",
      summary: "Update the parent's name",
      input: parentProfileInput,
      output: okSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return updateParentProfile({ userId, admin }, input);
      },
    }),
  },
});
