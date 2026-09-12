import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { lookupIpKey } from "@/lib/api/request-ip";
import { teamInvitePreviewSchema } from "@/lib/api/team-guardians-schema";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { previewGuardianInvite, previewTeamInviteInput } from "@/lib/team-guardians.server";

/**
 * Thin wrapper over the shared `previewGuardianInvite` (PRD §7.7, Appendix
 * A `[pub]`): what the `/team/:token` claim page renders before sign-in.
 * Unknown, used, or expired invites all answer `found: false` with null
 * names — a flat object, never a union. Public write: 30/minute per IP on
 * the route limiter (fails closed when degraded) plus the web's per-IP
 * lookup throttle keyed by a constant, so the token never reaches a table.
 */
export const Route = createFileRoute("/api/v1/team-invites/preview")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/team-invites/preview",
      operationId: "previewTeamInvite",
      auth: "public",
      rateLimit: { windowSeconds: 60, max: 30 },
      summary: "Who a Team plan guardian invite (token or code) is for",
      input: previewTeamInviteInput,
      output: teamInvitePreviewSchema,
      handler: async ({ input, request }) =>
        previewGuardianInvite(supabaseAdmin, lookupIpKey(request), input),
    }),
  },
});
