import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { resendTeamGuardianInvite } from "@/lib/team-guardians.server";

/**
 * Thin wrapper over the shared `resendTeamGuardianInvite` (PRD §7.7 "resend";
 * I13 decision D2 — new server logic, no web caller yet). `{id}` is
 * `guardian_invites.id`. Re-sends the SAME code and token to the invite's
 * email; an already-expired invite is extended first. 422 `unprocessable`
 * when the invite has no email on file (share the code instead); 404 when
 * it is not the caller's or no longer pending. `[idem]`; 10/hour per user.
 */
export const Route = createFileRoute("/api/v1/parent/team/guardians/invites/$id/resend")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/parent/team/guardians/invites/{id}/resend",
      operationId: "resendTeamGuardianInvite",
      auth: "user",
      idempotent: true,
      rateLimit: { windowSeconds: 3600, max: 10 },
      summary: "Re-send a pending guardian invite's email (same code and link)",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { admin, userId } = requireContext(ctx);
        return resendTeamGuardianInvite(admin, userId, {
          inviteId: z.string().uuid().parse(params.id),
        });
      },
    }),
  },
});
