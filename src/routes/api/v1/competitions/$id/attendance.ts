import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { ApiError } from "@/lib/api/errors";
import { requireContext } from "@/lib/api/auth";
import { recordAttendance } from "@/lib/competitions.server";

const outputSchema = z.object({ ok: z.boolean() });

/**
 * Thin wrapper over the shared `recordAttendance` (src/lib/competitions.server.ts).
 * Viewing a board while signed in calls this (PRD §6.9 "Attendance", §7.10);
 * the web addresses the competition by slug, the API by id (Appendix A).
 * `ok: false` means the caller has no profile or the competition is unknown —
 * neither is an error for the viewer, matching the web server function.
 */
export const Route = createFileRoute("/api/v1/competitions/$id/attendance")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/competitions/{id}/attendance",
      auth: "user",
      idempotent: true,
      summary: "Record that the caller is at a competition (they opened its Live Board)",
      output: outputSchema,
      handler: async ({ ctx, params }) => {
        const { admin, userId } = requireContext(ctx);
        const id = z.string().uuid().safeParse(params.id);
        if (!id.success) {
          throw new ApiError({
            code: "validation_failed",
            status: 400,
            message: "Competition id must be a UUID.",
          });
        }
        return recordAttendance(admin, userId, { id: id.data });
      },
    }),
  },
});
