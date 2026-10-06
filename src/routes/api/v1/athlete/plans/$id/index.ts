import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import {
  deleteAthletePlan,
  updateAthletePlan,
  updateAthletePlanPatch,
} from "@/lib/athlete-authoring.server";

const planId = (params: Record<string, string>) => z.string().uuid().parse(params.id);

/**
 * One plan the athlete wrote (PRD §6.14 B): PATCH is the per-field update
 * (title, notes); DELETE removes a draft or a benched plan (422
 * `not_deletable` for an active one: bench it first). Reading it is
 * `GET /api/v1/plans/{id}`, which serves the author their own view.
 */
export const Route = createFileRoute("/api/v1/athlete/plans/$id/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "PATCH",
        path: "/api/v1/athlete/plans/{id}",
        operationId: "updateAthletePlan",
        auth: "user",
        summary: "Update the title or notes of a plan the athlete wrote",
        input: updateAthletePlanPatch,
        output: okSchema,
        handler: async ({ ctx, input, params }) => {
          const { userId, supabase } = requireContext(ctx);
          return updateAthletePlan({ userId, supabase }, planId(params), input);
        },
      }),
      ...defineApiRoute({
        method: "DELETE",
        path: "/api/v1/athlete/plans/{id}",
        operationId: "deleteAthletePlan",
        auth: "user",
        summary: "Delete a draft or benched plan the athlete wrote",
        output: okSchema,
        handler: async ({ ctx, params }) => {
          const { userId, supabase } = requireContext(ctx);
          return deleteAthletePlan({ userId, supabase }, planId(params));
        },
      }),
    },
  },
});
