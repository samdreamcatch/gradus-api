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
 * `forbidden`) self-managed athletes, adults, and athletes with no birthdate
 * on file, so a guardian link over an adult's login is never a takeover.
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
