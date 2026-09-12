import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { commitScheduleImportResultSchema } from "@/lib/api/schedule-import-schema";
import { commitScheduleImport, commitScheduleImportInput } from "@/lib/schedule-import.server";

/**
 * Thin wrapper over the shared `commitScheduleImport` (PRD §3.6, Appendix A
 * "Schedule import"): the reviewed groups (one athlete each, with lesson
 * slots) are written onto the coach's roster — new athletes are created
 * with a guardian claim token and a queued invite, athletes already on this
 * coach's roster are matched by name and only gain slots, and slots are
 * de-duplicated on day + start. Sequential and non-transactional: every
 * group gets its own outcome (`created` | `linked` | `failed` | `skipped`),
 * and the roster cap is reported per athlete (`reason: "roster_full"` with
 * the plan's `limit`), never as a route-level 409. Coach-only (422
 * `unprocessable` "Coach profile not found"). `[idem]`: send a fresh
 * Idempotency-Key per submit; a replay never creates a second athlete or
 * sends a second invite.
 */
export const Route = createFileRoute("/api/v1/coach/schedule-import/commit")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/schedule-import/commit",
      operationId: "commitScheduleImport",
      auth: "user",
      idempotent: true,
      rateLimit: { windowSeconds: 3600, max: 20 },
      summary: "Commit reviewed schedule rows onto the coach's roster",
      input: commitScheduleImportInput,
      output: commitScheduleImportResultSchema,
      handler: async ({ ctx, input }) => {
        const { admin, userId } = requireContext(ctx);
        return commitScheduleImport({ admin, userId }, input, { apiContract: true });
      },
    }),
  },
});
