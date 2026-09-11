import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { removeGuardianById } from "@/lib/team-guardians.server";

/**
 * Thin wrapper over the shared `removeGuardianById` (PRD §7.7, Appendix A).
 * `{id}` is `athlete_guardians.id` — the `guardians[].id` from
 * `listTeamGuardians` (the web function takes `{ athleteId, parentId }`;
 * the API follows the PRD's single id). Primaries are never removable
 * (404); a co-guardian may remove themselves, otherwise the caller must
 * be the athlete's primary parent (403). No plan gate (parity).
 */
export const Route = createFileRoute("/api/v1/parent/team/guardians/$id")({
  server: {
    handlers: defineApiRoute({
      method: "DELETE",
      path: "/api/v1/parent/team/guardians/{id}",
      operationId: "removeTeamGuardian",
      auth: "user",
      summary: "Remove a co-guardian from an athlete",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { admin, userId } = requireContext(ctx);
        return removeGuardianById(
          admin,
          userId,
          { guardianId: z.string().uuid().parse(params.id) },
          { apiContract: true },
        );
      },
    }),
  },
});
