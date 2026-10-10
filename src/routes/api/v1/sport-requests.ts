import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { detectRole } from "@/lib/feedback.server";
import { enqueueAppEmail } from "@/lib/guardian.server";
import { requestSport, sportRequestInput } from "@/lib/sport-requests.server";

/**
 * Thin wrapper over the shared `requestSport` (beta feedback 2026-10-07):
 * a coach asks Gradus to add a sport that isn't listed, instead of inventing
 * a custom one. Stored for Admin → Leads and emailed to the team.
 * `[idem]`: a retry never files the same request twice.
 */
export const Route = createFileRoute("/api/v1/sport-requests")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/sport-requests",
      operationId: "requestSport",
      auth: "user",
      idempotent: true,
      rateLimit: { windowSeconds: 3600, max: 10 },
      summary: "Ask Gradus to add a sport that isn't listed",
      input: sportRequestInput,
      output: okSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin, claims } = requireContext(ctx);
        return requestSport(
          {
            userId,
            email: claims?.email ?? null,
            admin,
            role: () => detectRole(admin, userId),
            notify: (m) => enqueueAppEmail({ ...m, label: "sport-request" }),
          },
          input,
        );
      },
    }),
  },
});
