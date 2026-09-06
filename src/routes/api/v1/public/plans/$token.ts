import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { z } from "zod";
import { defineApiRoute, weakETag } from "@/lib/api/define-route";
import { ApiError } from "@/lib/api/errors";
import { sharedPlanSchema } from "@/lib/api/plans-schema";
import { getSharedPlanPublic } from "@/lib/plan-share.server";

/**
 * Thin wrapper over the shared `getSharedPlanPublic` (PRD §7.3 "Plan
 * sharing", Appendix A `[pub]`): the anonymized snapshot behind a share
 * link, for the import flow from a universal link. REST convention: an
 * unknown token is 404, where the web function returns null.
 */
export const Route = createFileRoute("/api/v1/public/plans/$token")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/public/plans/{token}",
      operationId: "getSharedPlan",
      auth: "public",
      summary: "A shared plan, by its share token",
      rateLimit: { windowSeconds: 60, max: 30 },
      output: sharedPlanSchema,
      // The snapshot changes whenever the coach edits the plan, so the validator is the body itself.
      etag: (plan) =>
        weakETag([
          "shared-plan",
          createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 16),
        ]),
      handler: async ({ params }) => {
        const plan = await getSharedPlanPublic(z.string().min(1).max(200).parse(params.token));
        if (!plan) {
          throw new ApiError({ code: "not_found", status: 404, message: "Plan not found." });
        }
        return plan;
      },
    }),
  },
});
