import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { resendGuardianInviteResultSchema } from "@/lib/api/guardian-schema";
import { resendGuardianInvite, resendGuardianInviteBodyInput } from "@/lib/guardian-claim.server";

/**
 * Thin wrapper over the shared `resendGuardianInvite` (PRD §3.5, §7.8,
 * Appendix A "Guardians"). `{id}` IS the athlete id (`athletes.id`) — a
 * guardian invite has no row of its own; the PRD's `{id}` names the athlete
 * whose invite is re-sent. The body carries only the optional new address
 * and may be omitted entirely (the contract declares it non-required):
 * no body, `{}`, or `{ "guardianEmail": … }` all re-send, the first two to
 * the address on file. Callable by the athlete themselves or a coach with
 * them on roster; parents get 403. Sends email, so `[idem]` plus a per-user
 * hourly limit.
 */
export const Route = createFileRoute("/api/v1/guardian/invites/$id/resend")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/guardian/invites/{id}/resend",
      operationId: "resendGuardianInvite",
      auth: "user",
      idempotent: true,
      rateLimit: { windowSeconds: 3600, max: 10 },
      summary:
        "Re-send an athlete's guardian invite, optionally to a new address ({id} = athlete id)",
      input: resendGuardianInviteBodyInput,
      output: resendGuardianInviteResultSchema,
      handler: async ({ ctx, input, params }) => {
        const { admin, userId } = requireContext(ctx);
        return resendGuardianInvite(admin, userId, {
          athleteId: z.string().uuid().parse(params.id),
          ...input,
        });
      },
    }),
  },
});
