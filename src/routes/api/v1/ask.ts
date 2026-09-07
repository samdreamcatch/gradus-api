import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { askGradusOutputSchema } from "@/lib/api/resources-schema";
import { askGradus, askGradusInput } from "@/lib/ask-gradus.server";

/**
 * Thin wrapper over the shared `askGradus` (PRD §7.9, Appendix A "Resources
 * and Ask Gradus"): a one-off question answered by an LLM, rate limited
 * like the voice routes since this is also an LLM call with real cost.
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
      handler: async ({ input }) => askGradus(input),
    }),
  },
});
