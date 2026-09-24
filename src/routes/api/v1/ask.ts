import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { askGradusOutputSchema } from "@/lib/api/resources-schema";
import { askGradus, askGradusInput } from "@/lib/ask-gradus.server";
import { askerCoachIds, resolveAskGradusAudience } from "@/lib/ask-gradus-audience.server";

/**
 * Thin wrapper over the shared `askGradus` (PRD §7.9, Appendix A "Resources
 * and Ask Gradus"): a one-off question answered by an LLM, rate limited
 * like the voice routes since this is also an LLM call with real cost.
 *
 * `audience` in the request body is never trusted directly (Mariah's call,
 * 2026-09-07): `resolveAskGradusAudience` re-derives it server-side from
 * the caller's real role and, for an athlete, a fresh birthdate check, so a
 * minor athlete's account can't get the athlete persona just by asking for
 * it. See `ask-gradus-audience.server.ts` for the full rule.
 */
export const Route = createFileRoute("/api/v1/ask")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/ask",
      operationId: "askGradus",
      auth: "user",
      rateLimit: { windowSeconds: 60, max: 10 },
      summary: "Ask Gradus a sport-specific coaching question",
      input: askGradusInput,
      output: askGradusOutputSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        const audience = await resolveAskGradusAudience(
          { userId, supabase, admin },
          input.audience,
        );
        // Grounded answers (L5): the corpus plus the asker's coaches' own uploads.
        const coachIds = await askerCoachIds({ userId, supabase, admin });
        return askGradus({ ...input, audience }, undefined, { coachIds });
      },
    }),
  },
});
