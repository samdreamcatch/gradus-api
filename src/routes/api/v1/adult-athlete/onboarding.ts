import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { adultOnboardingStatusSchema } from "@/lib/api/athlete-schema";
import { getAdultOnboardingStatus } from "@/lib/adult-athlete.server";

/** Thin wrapper over the shared `getAdultOnboardingStatus`: whether the athlete row exists yet. */
export const Route = createFileRoute("/api/v1/adult-athlete/onboarding")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/adult-athlete/onboarding",
      auth: "user",
      summary: "Adult athlete onboarding status",
      output: adultOnboardingStatusSchema,
      handler: async ({ ctx }) => {
        const { userId, supabase } = requireContext(ctx);
        return getAdultOnboardingStatus({ userId, supabase });
      },
    }),
  },
});
