import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { linkAthleteToSkaterResultSchema } from "@/lib/api/competition-results-schema";
import { linkAthleteToSkater, linkAthleteToSkaterInput } from "@/lib/competition-results.server";

const bodySchema = linkAthleteToSkaterInput.omit({ athleteId: true });

/**
 * Thin wrapper over the shared `linkAthleteToSkater` (PRD §7.10, Appendix A):
 * link a rostered athlete to a skater in a finished competition and store
 * that skater's results and protocols.
 */
export const Route = createFileRoute("/api/v1/athletes/$id/competition-links/")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/athletes/{id}/competition-links",
      operationId: "linkAthleteToSkater",
      auth: "user",
      summary: "Link a rostered athlete to a skater in a finished competition",
      input: bodySchema,
      output: linkAthleteToSkaterResultSchema,
      handler: async ({ ctx, input, params }) => {
        const { admin, userId } = requireContext(ctx);
        return linkAthleteToSkater(admin, userId, {
          athleteId: z.string().uuid().parse(params.id),
          ...input,
        });
      },
    }),
  },
});
