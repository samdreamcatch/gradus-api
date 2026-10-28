import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { adultGoalsListSchema } from "@/lib/api/athlete-schema";
import { okSchema } from "@/lib/api/onboarding-schema";
import {
  adultGoalsInput,
  getAdultAthleteGoals,
  saveAdultAthleteGoals,
} from "@/lib/adult-athlete.server";

/**
 * Thin wrappers over the shared `getAdultAthleteGoals` and
 * `saveAdultAthleteGoals`: GET reads the caller's goals per sport so the
 * onboarding goals step opens prefilled (a coach's starting levels from the
 * invite carry `suggestedByCoachName`, decision #60); PUT saves one sport's
 * level, target, and long-term goal.
 */
export const Route = createFileRoute("/api/v1/adult-athlete/goals")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/adult-athlete/goals",
        auth: "user",
        summary: "The caller's goals per sport, for prefilling",
        output: adultGoalsListSchema,
        handler: async ({ ctx }) => {
          const { userId, supabase, admin } = requireContext(ctx);
          return getAdultAthleteGoals({ userId, supabase, admin });
        },
      }),
      ...defineApiRoute({
        method: "PUT",
        path: "/api/v1/adult-athlete/goals",
        auth: "user",
        summary: "Save the caller's goals for a sport",
        input: adultGoalsInput,
        output: okSchema,
        handler: async ({ ctx, input }) => {
          const { userId, supabase, admin } = requireContext(ctx);
          return saveAdultAthleteGoals({ userId, supabase, admin }, input);
        },
      }),
    },
  },
});
