import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { parentInvitePreviewSchema } from "@/lib/api/onboarding-schema";
import { lookupIpKey } from "@/lib/api/request-ip";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { inviteCodeSchema, previewParentInvite } from "@/lib/invites.server";

const inputSchema = z.object({ code: inviteCodeSchema });

/** Thin wrapper over the shared `previewParentInvite` — the web's `getParentByInviteCode`: who a coach is about to link to. */
export const Route = createFileRoute("/api/v1/invites/parent/preview")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/invites/parent/preview",
      auth: "public",
      summary: "The parent behind a parent invite code",
      input: inputSchema,
      output: parentInvitePreviewSchema,
      rateLimit: { windowSeconds: 60, max: 30 },
      handler: async ({ input, request }) =>
        previewParentInvite(supabaseAdmin, lookupIpKey(request), input.code),
    }),
  },
});
