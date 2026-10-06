import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { defineApiRoute, weakETag } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { athletePlansSchema, planIdSchema } from "@/lib/api/plans-schema";
import { createAthletePlan, createAthletePlanInput } from "@/lib/athlete-authoring.server";
import { listAthletePlans } from "@/lib/athlete-plans.server";

/**
 * Thin wrappers over the shared `listAthletePlans` and `createAthletePlan`
 * (PRD §7.8 and §6.14, Appendix A `[etag]` / `[idem]`): the signed-in
 * athlete's active and benched plans (seeding the Gradus starter programs on
 * first read, marking the ones they wrote with `source`, and listing their own
 * drafts in `drafts`), and a new draft of their own, optionally a copy of one
 * of their plans. A retry never creates two.
 */
export const Route = createFileRoute("/api/v1/athlete/plans/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/athlete/plans",
        operationId: "listAthletePlans",
        auth: "user",
        summary: "The athlete's own plans",
        output: athletePlansSchema,
        etag: (body) =>
          weakETag([
            "athlete-plans",
            createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16),
          ]),
        handler: async ({ ctx }) => {
          const { userId, supabase, admin } = requireContext(ctx);
          return listAthletePlans({ userId, supabase, admin, includeAuthored: true });
        },
      }),
      ...defineApiRoute({
        method: "POST",
        path: "/api/v1/athlete/plans",
        operationId: "createAthletePlan",
        auth: "user",
        idempotent: true,
        summary: "Create a draft plan of the athlete's own",
        input: createAthletePlanInput,
        output: planIdSchema,
        handler: async ({ ctx, input }) => {
          const { userId, supabase } = requireContext(ctx);
          return createAthletePlan({ userId, supabase }, input);
        },
      }),
    },
  },
});
