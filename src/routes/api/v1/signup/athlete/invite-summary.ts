import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { athleteInviteSummarySchema } from "@/lib/api/athlete-schema";
import { lookupIpKey } from "@/lib/api/request-ip";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getAthleteInviteSummary } from "@/lib/athlete-signup.server";
import { inviteCodeSchema } from "@/lib/invites.server";

const inputSchema = z.object({ code: inviteCodeSchema });

/** Thin wrapper over the shared `getAthleteInviteSummary` (PRD §7.1 "Athlete (minor) sign-up"): who the code is for, before an account exists. */
export const Route = createFileRoute("/api/v1/signup/athlete/invite-summary")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/signup/athlete/invite-summary",
      auth: "public",
      summary: "The athlete, coach, and sports behind an athlete invite code",
      input: inputSchema,
      output: athleteInviteSummarySchema,
      rateLimit: { windowSeconds: 60, max: 30 },
      handler: async ({ input, request }) =>
        getAthleteInviteSummary(supabaseAdmin, lookupIpKey(request), input.code),
    }),
  },
});
