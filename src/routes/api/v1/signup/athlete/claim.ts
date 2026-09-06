import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { athleteClaimResultSchema } from "@/lib/api/athlete-schema";
import { claimAthleteInvite } from "@/lib/athlete-signup.server";
import { inviteCodeSchema } from "@/lib/invites.server";

const inputSchema = z.object({ code: inviteCodeSchema });

/** Thin wrapper over the shared `claimAthleteInvite`: bind the athlete row to the signed-in user and consume the code. Idempotent. */
export const Route = createFileRoute("/api/v1/signup/athlete/claim")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/signup/athlete/claim",
      auth: "user",
      idempotent: true,
      summary: "Claim an athlete invite with an existing account",
      input: inputSchema,
      output: athleteClaimResultSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return claimAthleteInvite({ userId, admin }, input.code);
      },
    }),
  },
});
