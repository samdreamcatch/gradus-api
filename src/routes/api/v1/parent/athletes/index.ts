import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { addParentAthleteResultSchema } from "@/lib/api/parent-settings-schema";
import { addParentAthlete, newParentAthleteInput } from "@/lib/parent-settings.server";

/**
 * Thin wrapper over the shared `addParentAthlete` (PRD §7.7). `[idem]`: a
 * retry never creates the athlete twice.
 */
export const Route = createFileRoute("/api/v1/parent/athletes/")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/parent/athletes",
      operationId: "addParentAthlete",
      auth: "user",
      idempotent: true,
      summary: "Add an athlete to the parent's account",
      input: newParentAthleteInput,
      output: addParentAthleteResultSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return addParentAthlete({ userId, admin }, input);
      },
    }),
  },
});
