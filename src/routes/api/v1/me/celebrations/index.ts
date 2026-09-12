import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { celebrationPayloadSchema } from "@/lib/api/connection-celebration-schema";
import { getPendingConnectionCelebrations } from "@/lib/connection-celebration.server";

/**
 * Thin wrapper over the shared `getPendingConnectionCelebrations` (PRD §7.14,
 * Appendix A "Me"). Always 200: minors and accounts with no role get
 * `{ role: null, groups: [] }`, so the iOS shell can call it unconditionally
 * (on foreground and after any link-creating call). `apiContract` makes the
 * role precedence mirror `GET /me` (D7). No ETag — the list is tiny and
 * consumed once.
 */
export const Route = createFileRoute("/api/v1/me/celebrations/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/me/celebrations",
      operationId: "getMeCelebrations",
      auth: "user",
      summary: "Pending connection celebrations for the caller, grouped per other party",
      output: celebrationPayloadSchema,
      handler: async ({ ctx }) => {
        const { admin, userId } = requireContext(ctx);
        return getPendingConnectionCelebrations(admin, userId, { apiContract: true });
      },
    }),
  },
});
