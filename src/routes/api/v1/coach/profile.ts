import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { coachProfileResponseSchema, okSchema } from "@/lib/api/onboarding-schema";
import {
  coachContext,
  coachNameSchema,
  getCoachProfile,
  saveCoachProfile,
} from "@/lib/coach-onboarding.server";

/**
 * Thin wrappers over the shared `getCoachProfile` / `saveCoachProfile`
 * (src/lib/coach-onboarding.server.ts) — the web's server functions of the
 * same names (PRD §7.1 "Coach onboarding", Appendix A). Reading creates
 * the coach row on first sight, seeded from the token's name metadata.
 */
export const Route = createFileRoute("/api/v1/coach/profile")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/coach/profile",
        auth: "user",
        summary: "The caller's coach profile, entitlement, and sports",
        output: coachProfileResponseSchema,
        handler: async ({ ctx }) => getCoachProfile(coachContext(requireContext(ctx))),
      }),
      ...defineApiRoute({
        method: "PUT",
        path: "/api/v1/coach/profile",
        auth: "user",
        summary: "Set the coach's first and last name",
        input: coachNameSchema,
        output: okSchema,
        handler: async ({ ctx, input }) =>
          saveCoachProfile(coachContext(requireContext(ctx)), input),
      }),
    },
  },
});
