import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { adultCoachPreviewSchema } from "@/lib/api/athlete-schema";
import { previewCoachForAdultAthlete } from "@/lib/adult-athlete.server";
import { inviteCodeSchema } from "@/lib/invites.server";

const inputSchema = z.object({ code: inviteCodeSchema });

/** Thin wrapper over the shared `previewCoachForAdultAthlete`: the coach behind a code, for a signed-in athlete. */
export const Route = createFileRoute("/api/v1/adult-athlete/coach/preview")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/adult-athlete/coach/preview",
      auth: "user",
      summary: "Preview a coach by invite code",
      input: inputSchema,
      output: adultCoachPreviewSchema,
      handler: async ({ ctx, input }) => previewCoachForAdultAthlete(requireContext(ctx), input.code),
    }),
  },
});
