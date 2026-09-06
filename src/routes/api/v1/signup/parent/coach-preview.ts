import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { coachPreviewSchema } from "@/lib/api/signup-schema";
import { inviteCodeSchema } from "@/lib/invites.server";
import { getCoachByInviteCode } from "@/lib/parent-signup.server";

const inputSchema = z.object({ code: inviteCodeSchema });

/** Thin wrapper over the shared `getCoachByInviteCode`: the coach a parent is about to link to, and their sports. */
export const Route = createFileRoute("/api/v1/signup/parent/coach-preview")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/signup/parent/coach-preview",
      auth: "user",
      summary: "The coach behind a coach invite code",
      input: inputSchema,
      output: coachPreviewSchema,
      handler: async ({ ctx, input }) => getCoachByInviteCode(requireContext(ctx).admin, input.code),
    }),
  },
});
