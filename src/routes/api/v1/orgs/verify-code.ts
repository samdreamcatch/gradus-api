import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { orgCodeVerificationSchema } from "@/lib/api/onboarding-schema";
import { orgCodeSchema, verifyOrgCodeForOrg } from "@/lib/orgs.server";

const inputSchema = z.object({ orgId: z.string().uuid(), code: orgCodeSchema });

/** Thin wrapper over the shared `verifyOrgCodeForOrg`: the code must unlock the club the coach picked. */
export const Route = createFileRoute("/api/v1/orgs/verify-code")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/orgs/verify-code",
      auth: "user",
      summary: "Check an invite code against a chosen club",
      input: inputSchema,
      output: orgCodeVerificationSchema,
      handler: async ({ ctx, input }) => verifyOrgCodeForOrg(requireContext(ctx).admin, input),
    }),
  },
});
