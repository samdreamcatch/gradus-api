import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { dismissCompetitionRecap } from "@/lib/competition-recap.server";

/** Thin wrapper over the shared `dismissCompetitionRecap` (PRD §7.10, Appendix A). */
export const Route = createFileRoute("/api/v1/recaps/$id/dismiss")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/recaps/{id}/dismiss",
      operationId: "dismissCompetitionRecap",
      auth: "user",
      summary: "Dismiss the pending recap prompt for a competition",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { admin, userId } = requireContext(ctx);
        return dismissCompetitionRecap(admin, userId, {
          competitionId: z.string().uuid().parse(params.id),
        });
      },
    }),
  },
});
