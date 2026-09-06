import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { orgLookupSchema } from "@/lib/api/onboarding-schema";
import { getOrganizationByInviteCode, orgCodeSchema } from "@/lib/orgs.server";

const inputSchema = z.object({ code: orgCodeSchema });

/** Thin wrapper over the shared `getOrganizationByInviteCode`: which club a code belongs to. */
export const Route = createFileRoute("/api/v1/orgs/lookup-code")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/orgs/lookup-code",
      auth: "user",
      summary: "The club behind an invite code",
      input: inputSchema,
      output: orgLookupSchema,
      handler: async ({ ctx, input }) =>
        getOrganizationByInviteCode(requireContext(ctx).admin, input.code),
    }),
  },
});
