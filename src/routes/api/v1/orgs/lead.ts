import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { clubLeadInput, recordSilentClubLead } from "@/lib/orgs.server";

/** Thin wrapper over the shared `recordSilentClubLead`: a coach bounced off the club path; recorded for outreach, no prompt. */
export const Route = createFileRoute("/api/v1/orgs/lead")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/orgs/lead",
      auth: "user",
      summary: "Record that a coach could not find or unlock their club",
      input: clubLeadInput,
      output: okSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase, claims } = requireContext(ctx);
        return recordSilentClubLead({ userId, supabase, email: claims?.email ?? null }, input);
      },
    }),
  },
});
