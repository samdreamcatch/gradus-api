import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { athleteIdResultSchema } from "@/lib/api/athlete-schema";
import {
  createSelfManagedAthlete,
  createSelfManagedAthleteInput,
} from "@/lib/adult-athlete.server";

/**
 * Thin wrapper over the shared `createSelfManagedAthlete` (PRD §7.1 "Adult
 * athlete sign-up"): the caller's own athlete row. Minors need a guardian
 * email, who is emailed a claim link. Idempotent.
 */
export const Route = createFileRoute("/api/v1/signup/adult-athlete")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/signup/adult-athlete",
      auth: "user",
      idempotent: true,
      summary: "Create the caller's self-managed athlete profile",
      input: createSelfManagedAthleteInput,
      output: athleteIdResultSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return createSelfManagedAthlete({ userId, admin }, input);
      },
    }),
  },
});
