import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import {
  submitCompetitionRecap,
  submitCompetitionRecapInput,
} from "@/lib/competition-recap.server";

/**
 * Thin wrapper over the shared `submitCompetitionRecap` (PRD §7.10, Appendix
 * A). `[idem]`: a retried submit never posts the recap message to the
 * athlete's coaches twice.
 */
export const Route = createFileRoute("/api/v1/recaps/")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/recaps",
      operationId: "submitCompetitionRecap",
      auth: "user",
      idempotent: true,
      summary: "Submit a competition recap; posts into the athlete's coach message threads",
      input: submitCompetitionRecapInput,
      output: okSchema,
      handler: async ({ ctx, input }) => {
        const { admin, userId } = requireContext(ctx);
        return submitCompetitionRecap(admin, userId, input);
      },
    }),
  },
});
