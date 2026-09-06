import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { linkAthletesInput, linkAthletesToCoach } from "@/lib/parent-signup.server";

/**
 * Thin wrapper over the shared `linkAthletesToCoach` (PRD §7.1 "Parent
 * sign-up", athletes step): creates the athletes and links them to the
 * coach behind the code. Idempotent, so a retry cannot create them twice.
 */
export const Route = createFileRoute("/api/v1/signup/parent/link-coach")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/signup/parent/link-coach",
      auth: "user",
      idempotent: true,
      summary: "Add the parent's athletes and link them to the coach",
      input: linkAthletesInput,
      output: okSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return linkAthletesToCoach({ userId, admin }, input);
      },
    }),
  },
});
