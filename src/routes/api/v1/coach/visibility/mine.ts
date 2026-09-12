import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { defineApiRoute, weakETag } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { myCoachVisibilitySchema } from "@/lib/api/coach-visibility-schema";
import { listMyCoachVisibility } from "@/lib/coach-visibility.server";

/**
 * Thin wrapper over the shared `listMyCoachVisibility` (PRD Appendix A
 * `[etag]`): requests waiting on the signed-in coach, connected coaches, and
 * links they accepted that still wait on the other coach. Non-coaches get
 * three empty arrays (200), as on the web. The validator is a digest of the
 * body, so `If-None-Match` answers 304 while nothing changed.
 */
export const Route = createFileRoute("/api/v1/coach/visibility/mine")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/visibility/mine",
      operationId: "listMyCoachVisibility",
      auth: "user",
      summary: "Visibility requests and connections for the signed-in coach",
      output: myCoachVisibilitySchema,
      etag: (out) =>
        weakETag([
          "my-coach-visibility",
          createHash("sha256").update(JSON.stringify(out)).digest("hex").slice(0, 16),
        ]),
      handler: async ({ ctx }) => {
        const { admin, userId } = requireContext(ctx);
        return listMyCoachVisibility(admin, userId);
      },
    }),
  },
});
