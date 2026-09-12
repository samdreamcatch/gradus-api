import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { defineApiRoute, weakETag } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { parentCoachVisibilitySchema } from "@/lib/api/coach-visibility-schema";
import { okSchema } from "@/lib/api/onboarding-schema";
import {
  listCoachVisibility,
  setCoachVisibility,
  setCoachVisibilityInput,
} from "@/lib/coach-visibility.server";

/**
 * Parent role (PRD Appendix A files these under `/coach/visibility`; they
 * live under `/parent/**` for role consistency with I8). Thin wrappers over
 * the shared `listCoachVisibility` and `setCoachVisibility`.
 *
 * GET `[etag]`: every reachable athlete, their coaches, and each coach's
 * share state; `planActive` includes co-guardian coverage, so iOS gates the
 * toggles on it rather than on `GET /parent/team`. The validator is a digest
 * of the body, so `If-None-Match` answers 304 while nothing changed.
 *
 * PUT `[idem]`: by value, so an outbox replay is safe; the Idempotency-Key
 * keeps a queued replay from emailing the coaches twice. Enabling fans out a
 * best-effort email per coach per new pair, hence the per-user throttle.
 */
export const Route = createFileRoute("/api/v1/parent/coach-visibility")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/parent/coach-visibility",
        operationId: "listParentCoachVisibility",
        auth: "user",
        summary: "Coach visibility per athlete and coach, as the parent sees it",
        output: parentCoachVisibilitySchema,
        etag: (out) =>
          weakETag([
            "parent-coach-visibility",
            createHash("sha256").update(JSON.stringify(out)).digest("hex").slice(0, 16),
          ]),
        handler: async ({ ctx }) => {
          const { admin, userId } = requireContext(ctx);
          return listCoachVisibility(admin, userId, { apiContract: true });
        },
      }),
      ...defineApiRoute({
        method: "PUT",
        path: "/api/v1/parent/coach-visibility",
        operationId: "setParentCoachVisibility",
        auth: "user",
        idempotent: true,
        rateLimit: { windowSeconds: 3600, max: 30 },
        summary: "Turn one coach's visibility on or off for one athlete (Team plan)",
        input: setCoachVisibilityInput,
        output: okSchema,
        handler: async ({ ctx, input }) => {
          const { admin, userId } = requireContext(ctx);
          return setCoachVisibility(admin, userId, input);
        },
      }),
    },
  },
});
