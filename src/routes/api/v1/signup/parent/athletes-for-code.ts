import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { athletesForCodeSchema } from "@/lib/api/signup-schema";
import { listAthletesForCode, optionalInviteCodeSchema } from "@/lib/parent-signup.server";

const inputSchema = z.object({ code: optionalInviteCodeSchema });

/** Thin wrapper over the shared `listAthletesForCode`: the athletes the goals and schedule steps walk through, and the sports to offer. */
export const Route = createFileRoute("/api/v1/signup/parent/athletes-for-code")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/signup/parent/athletes-for-code",
      auth: "user",
      summary: "The parent's athletes for a coach code, and the sports to choose from",
      input: inputSchema,
      output: athletesForCodeSchema,
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        return listAthletesForCode({ userId, admin }, input.code);
      },
    }),
  },
});
