import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { athleteBillingSchema } from "@/lib/api/invoicing-schema";
import { getAthleteBilling } from "@/lib/invoicing.server";

/** Thin wrapper over the shared `getAthleteBilling` (PRD §7.11 "Billing and invoicing"). */
export const Route = createFileRoute("/api/v1/coach/athletes/$id/billing")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/athletes/{id}/billing",
      operationId: "getAthleteBilling",
      auth: "user",
      summary: "One athlete's rate and invoice history",
      output: athleteBillingSchema,
      handler: async ({ ctx, params }) => {
        const { userId, supabase } = requireContext(ctx);
        return getAthleteBilling({ userId, supabase }, z.string().uuid().parse(params.id));
      },
    }),
  },
});
