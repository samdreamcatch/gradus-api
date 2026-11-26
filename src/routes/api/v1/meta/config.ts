import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import {
  isCoachPaywallEnabled,
  isCoachProAvailable,
  FOUNDING_COACH_CUTOFF,
} from "@/lib/paywall-flag";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

const outputSchema = z.object({
  paywallEnabled: z.boolean(),
  coachProEnabled: z.boolean(),
  foundingCoachCutoff: z.string(),
  termsVersion: z.string(),
  // This server runs the message check on every send (PRD #64). Optional so an app built
  // against this contract still reads a server from before the check: there the app holds
  // flagged messages itself.
  messageCheck: z.boolean().optional(),
});

export const Route = createFileRoute("/api/v1/meta/config")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/meta/config",
      auth: "public",
      summary: "Public feature flags and terms version",
      output: outputSchema,
      handler: async () => ({
        paywallEnabled: isCoachPaywallEnabled(),
        coachProEnabled: isCoachProAvailable(),
        foundingCoachCutoff: FOUNDING_COACH_CUTOFF.toISOString(),
        termsVersion: CURRENT_TERMS_VERSION,
        messageCheck: true,
      }),
    }),
  },
});
