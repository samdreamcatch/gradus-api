import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { addAthleteResultSchema } from "@/lib/api/roster-schema";
import { addAthleteInput, addAthleteWithGuardian } from "@/lib/coach-roster.server";

/**
 * Thin wrapper over the shared `addAthleteWithGuardian` (PRD §7.2 "Add
 * athlete with guardian"). `[idem]`: a retry never creates the athlete
 * twice. A full roster answers 409 `roster_full`.
 */
export const Route = createFileRoute("/api/v1/coach/roster/athletes/")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/roster/athletes",
      operationId: "addRosterAthlete",
      auth: "user",
      idempotent: true,
      summary: "Add an athlete to the roster and invite their guardian",
      input: addAthleteInput,
      output: addAthleteResultSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return addAthleteWithGuardian({ userId, admin }, input);
      },
    }),
  },
});
