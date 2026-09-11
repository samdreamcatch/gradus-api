import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { recapCoachSchema } from "@/lib/api/competition-recap-schema";
import { getRecapCoaches, recapCoachesInput } from "@/lib/competition-recap.server";

/** Thin wrapper over the shared `getRecapCoaches` (PRD §7.10, Appendix A). */
export const Route = createFileRoute("/api/v1/recaps/coaches")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/recaps/coaches",
      operationId: "getRecapCoaches",
      auth: "user",
      summary: "The rostered coaches a recap can be sent to for this athlete",
      query: recapCoachesInput,
      output: z.array(recapCoachSchema),
      handler: async ({ ctx, query }) => {
        const { admin, userId } = requireContext(ctx);
        return getRecapCoaches(admin, userId, query);
      },
    }),
  },
});
