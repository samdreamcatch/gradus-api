import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { adultAthleteInvitePreviewSchema } from "@/lib/api/onboarding-schema";
import { lookupIpKey } from "@/lib/api/request-ip";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { inviteCodeSchema, previewAdultAthleteInvite } from "@/lib/invites.server";

const inputSchema = z.object({ code: inviteCodeSchema });

/** Thin wrapper over the shared `previewAdultAthleteInvite` — the web's `getAdultAthleteByInviteCode`. */
export const Route = createFileRoute("/api/v1/invites/adult-athlete/preview")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/invites/adult-athlete/preview",
      auth: "public",
      summary: "The athlete behind an adult-athlete invite code",
      input: inputSchema,
      output: adultAthleteInvitePreviewSchema,
      rateLimit: { windowSeconds: 60, max: 30 },
      handler: async ({ input, request }) =>
        previewAdultAthleteInvite(supabaseAdmin, lookupIpKey(request), input.code),
    }),
  },
});
