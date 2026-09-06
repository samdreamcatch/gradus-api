import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { adultCoachLinkResultSchema } from "@/lib/api/athlete-schema";
import { linkAdultAthleteToCoach, linkAdultCoachInput } from "@/lib/adult-athlete.server";

/** Thin wrapper over the shared `linkAdultAthleteToCoach`: roster the caller with a coach for the chosen sports. Idempotent. */
export const Route = createFileRoute("/api/v1/adult-athlete/coach/link")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/adult-athlete/coach/link",
      auth: "user",
      idempotent: true,
      summary: "Link the caller to a coach by invite code",
      input: linkAdultCoachInput,
      output: adultCoachLinkResultSchema,
      handler: async ({ ctx, input }) => linkAdultAthleteToCoach(requireContext(ctx), input),
    }),
  },
});
