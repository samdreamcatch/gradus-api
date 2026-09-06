import { createFileRoute } from "@tanstack/react-router";
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
      etag: (plan) => (plan.sharedAt ? weakETag(["shared-plan", plan.sharedAt]) : null),
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
