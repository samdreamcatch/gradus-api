import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import {
  clearPracticeTarget,
  practiceTargetInput,
  setPracticeTarget,
} from "@/lib/practice-targets.server";

const athleteId = (params: Record<string, string>) => z.string().uuid().parse(params.id);
const clearQuery = z.object({ sport: z.string().min(1).max(64) });

/** Thin wrappers over the shared `setPracticeTarget` and `clearPracticeTarget` (PRD §7.2 "Practice targets"). */
export const Route = createFileRoute("/api/v1/coach/athletes/$id/practice-target")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "PUT",
        path: "/api/v1/coach/athletes/{id}/practice-target",
        operationId: "setPracticeTarget",
        auth: "user",
        summary: "Set the weekly practice target for an athlete in a sport",
        input: practiceTargetInput,
        output: okSchema,
        handler: async ({ ctx, input, params }) => {
          const { userId, supabase } = requireContext(ctx);
          return setPracticeTarget({ userId, supabase }, athleteId(params), input);
        },
      }),
      ...defineApiRoute({
        method: "DELETE",
        path: "/api/v1/coach/athletes/{id}/practice-target",
        operationId: "clearPracticeTarget",
        auth: "user",
        summary: "Clear the weekly practice target (`?sport=`)",
        query: clearQuery,
        output: okSchema,
        handler: async ({ ctx, params, query }) => {
          const { userId, supabase } = requireContext(ctx);
          return clearPracticeTarget({ userId, supabase }, athleteId(params), query.sport);
        },
      }),
    },
  },
});
