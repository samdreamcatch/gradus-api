import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { resetAthletePasswordResultSchema } from "@/lib/api/parent-settings-schema";
import { athleteIdParam } from "@/lib/api/parent-params";
import { athletePasswordInput, resetParentAthletePassword } from "@/lib/parent-settings.server";

/**
 * Thin wrapper over the shared `resetParentAthletePassword` (PRD §7.7):
 * set a new password for an athlete who has an account. Rate-limited, as
 * every credential-changing route is. `parentManagedOnly` refuses (403
 * `forbidden`) a self-managed athlete, so a guardian link is never a way to
 * take over someone's own login; parent-managed accounts (the only ones a
 * parent can reach) stay resettable at any age, as on the web.
 */
export const Route = createFileRoute("/api/v1/parent/athletes/$id/reset-password")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/parent/athletes/{id}/reset-password",
      operationId: "resetParentAthletePassword",
      auth: "user",
      summary: "Reset an athlete's password",
      input: athletePasswordInput,
      output: resetAthletePasswordResultSchema,
      rateLimit: { windowSeconds: 3600, max: 10 },
      handler: async ({ ctx, input, params }) => {
        const { userId, admin } = requireContext(ctx);
        return resetParentAthletePassword({ userId, admin }, athleteIdParam(params), input, {
          parentManagedOnly: true,
        });
      },
    }),
  },
});
