import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { importedPlanSchema } from "@/lib/api/plans-schema";
import { importSharedPlan } from "@/lib/plan-share.server";

/** Thin wrapper over the shared `importSharedPlan`: a shared plan becomes a template in the caller's library. */
export const Route = createFileRoute("/api/v1/plans/import/$token")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/plans/import/{token}",
      operationId: "importSharedPlan",
      auth: "user",
      summary: "Import a shared plan as a template",
      output: importedPlanSchema,
      handler: async ({ ctx, params }) => {
        const { supabase } = requireContext(ctx);
        return importSharedPlan({ supabase }, z.string().min(1).max(200).parse(params.token));
      },
    }),
  },
});
