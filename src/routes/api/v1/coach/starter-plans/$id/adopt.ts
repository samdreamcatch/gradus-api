import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { adoptStarterPlan } from "@/lib/starter-programs.server";

/** Thin wrapper over the shared `adoptStarterPlan` (PRD §7.3 "Starter programs"): the Gradus plan becomes the coach's own. */
export const Route = createFileRoute("/api/v1/coach/starter-plans/$id/adopt")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/starter-plans/{id}/adopt",
      operationId: "adoptStarterPlan",
      auth: "user",
      summary: "Adopt a Gradus starter plan",
      output: okSchema,
      handler: async ({ ctx, params }) => {
        const { userId, admin } = requireContext(ctx);
        return adoptStarterPlan({ userId, admin }, z.string().uuid().parse(params.id));
      },
    }),
  },
});
