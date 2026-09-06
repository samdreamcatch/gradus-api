import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { clearOrganizationResultSchema } from "@/lib/api/onboarding-schema";
import { clearOrganizationLink } from "@/lib/orgs.server";

/** Thin wrapper over the shared `clearOrganizationLink`: leave the club; a club-covered coach gets the 90-day grace. */
export const Route = createFileRoute("/api/v1/coach/org")({
  server: {
    handlers: defineApiRoute({
      method: "DELETE",
      path: "/api/v1/coach/org",
      auth: "user",
      summary: "Leave the coach's club",
      output: clearOrganizationResultSchema,
      handler: async ({ ctx }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return clearOrganizationLink({ userId, supabase, admin });
      },
    }),
  },
});
