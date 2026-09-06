import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { sportsResponseSchema } from "@/lib/api/athlete-schema";
import { getCoachOfferedSportsForAdult } from "@/lib/adult-athlete.server";

const inputSchema = z.object({ coachId: z.string().uuid() });

/** Thin wrapper over the shared `getCoachOfferedSportsForAdult`: everything a linked coach offers. */
export const Route = createFileRoute("/api/v1/adult-athlete/coach/sports-offered")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/adult-athlete/coach/sports-offered",
      auth: "user",
      summary: "Sports a linked coach offers",
      input: inputSchema,
      output: sportsResponseSchema,
      handler: async ({ ctx, input }) => getCoachOfferedSportsForAdult(requireContext(ctx), input.coachId),
    }),
  },
});
