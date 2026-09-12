import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { parentTeamPlanResponseSchema } from "@/lib/api/family-goals-schema";
import { getTeamPlanStatus } from "@/lib/team.server";

/**
 * The web's Team page, where the plan is bought and billing managed. The
 * app shows this link only on the US storefront (PRD §6.8 rule 3); the
 * server just supplies the URL.
 */
const MANAGE_URL = "https://gradus.training/parent/team";

/** Thin wrapper over the shared `getTeamPlanStatus` (PRD §7.8): the parent's Team plan status. */
export const Route = createFileRoute("/api/v1/parent/team/")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/parent/team",
      operationId: "getParentTeamPlan",
      auth: "user",
      summary: "The parent's Team plan status",
      output: parentTeamPlanResponseSchema,
      handler: async ({ ctx }) => {
        const { userId, supabase } = requireContext(ctx);
        const status = await getTeamPlanStatus({ userId, supabase });
        return { ...status, manageUrl: MANAGE_URL };
      },
    }),
  },
});
