import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { inviteResolutionSchema } from "@/lib/api/onboarding-schema";
import { lookupIpKey } from "@/lib/api/request-ip";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { inviteCodeSchema, resolveInviteCode } from "@/lib/invites.server";

const inputSchema = z.object({ code: inviteCodeSchema });

/**
 * Thin wrapper over the shared `resolveInviteCode` — the web's universal
 * `/i/:code` entry (PRD §7.1 "Invite entry"). Public; throttled per IP by
 * the same `record_invite_lookup_attempt` window the web uses, plus the
 * route limiter, so codes cannot be enumerated.
 */
export const Route = createFileRoute("/api/v1/invites/resolve")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/invites/resolve",
      auth: "public",
      summary: "Which kind of invite an 8-character code is, and whether it is still valid",
      input: inputSchema,
      output: inviteResolutionSchema,
      rateLimit: { windowSeconds: 60, max: 30 },
      handler: async ({ input, request }) =>
        resolveInviteCode(supabaseAdmin, lookupIpKey(request), input.code),
    }),
  },
});
