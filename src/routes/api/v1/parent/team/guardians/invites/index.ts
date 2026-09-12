import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { inviteGuardianResultSchema } from "@/lib/api/team-guardians-schema";
import { inviteGuardian, inviteGuardianInput } from "@/lib/team-guardians.server";

/**
 * Thin wrapper over the shared `inviteGuardian` (PRD §7.7, Appendix A).
 * `[idem]`: a retried create never mints a second invite or re-sends the
 * email. Returns the raw claim token (parity) so the app can offer a share
 * link alongside the code. Email delivery is best-effort: `ok: true` even
 * when the enqueue failed, as on the web. Per-user limit: 10 invites/hour.
 */
export const Route = createFileRoute("/api/v1/parent/team/guardians/invites/")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/parent/team/guardians/invites",
      operationId: "inviteTeamGuardian",
      auth: "user",
      idempotent: true,
      rateLimit: { windowSeconds: 3600, max: 10 },
      summary: "Invite another parent or guardian to an athlete (Team plan)",
      input: inviteGuardianInput,
      output: inviteGuardianResultSchema,
      handler: async ({ ctx, input }) => {
        const { admin, userId } = requireContext(ctx);
        return inviteGuardian(admin, userId, input);
      },
    }),
  },
});
