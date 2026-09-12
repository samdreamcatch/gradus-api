import { createHash } from "crypto";
import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute, weakETag } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { teamGuardiansSchema } from "@/lib/api/team-guardians-schema";
import { listTeamGuardians } from "@/lib/team-guardians.server";

/**
 * Thin wrapper over the shared `listTeamGuardians` (PRD §7.7, Appendix A).
 * `planActive` here is payer OR covered by another primary's plan — the app
 * gates guardian UI on this field, not on `GET /parent/team.active`
 * (payer-only). `[etag]` from a digest of the body: no stamp exists.
 *
 * API contract (I13 decision D6): pending invites are listed only for
 * athletes the caller is primary on; co-guardians get `invites: []`.
 */
export const Route = createFileRoute("/api/v1/parent/team/guardians/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/parent/team/guardians",
      operationId: "listTeamGuardians",
      auth: "user",
      summary: "Guardians and pending invites for each of the parent's athletes",
      output: teamGuardiansSchema,
      etag: (out) =>
        weakETag([
          "team-guardians",
          createHash("sha256").update(JSON.stringify(out)).digest("hex").slice(0, 16),
        ]),
      handler: async ({ ctx }) => {
        const { admin, userId } = requireContext(ctx);
        return listTeamGuardians(admin, userId, { apiContract: true });
      },
    }),
  },
});
