import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { adultAthleteClaimResultSchema } from "@/lib/api/onboarding-schema";
import { claimAdultAthleteInvite, claimInviteInput } from "@/lib/invites.server";

/** Thin wrapper over the shared `claimAdultAthleteInvite`: an onboarded coach links one self-managed athlete. Idempotent. */
export const Route = createFileRoute("/api/v1/invites/adult-athlete/claim")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/invites/adult-athlete/claim",
      auth: "user",
      idempotent: true,
      summary: "Claim an adult-athlete invite as a coach",
      input: claimInviteInput,
      output: adultAthleteClaimResultSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return claimAdultAthleteInvite({ userId, admin }, input);
      },
    }),
  },
});
