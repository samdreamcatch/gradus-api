import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { defineApiRoute, weakETag } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { coachRosterSchema } from "@/lib/api/roster-schema";
import { getCoachRoster } from "@/lib/coach-roster.server";

/**
 * Thin wrapper over the shared `getCoachRoster` (PRD §7.2, Appendix A
 * `[etag]`): the roster with each athlete's recurring slots and per-date
 * overrides. The validator is a digest of the body, so `If-None-Match`
 * answers 304 while nothing changed.
 */
export const Route = createFileRoute("/api/v1/coach/roster/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/roster",
      operationId: "getCoachRoster",
      auth: "user",
      summary: "The coach's roster with lesson slots",
      output: coachRosterSchema,
      etag: (roster) =>
        weakETag([
          "roster",
          createHash("sha256").update(JSON.stringify(roster)).digest("hex").slice(0, 16),
        ]),
      handler: async ({ ctx }) => {
        const { userId, admin } = requireContext(ctx);
        return getCoachRoster({ userId, admin });
      },
    }),
  },
});
