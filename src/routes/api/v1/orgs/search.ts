import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { organizationSearchSchema } from "@/lib/api/onboarding-schema";
import { searchOrganizations } from "@/lib/orgs.server";

const inputSchema = z.object({ query: z.string().trim().max(80) });

/** Thin wrapper over the shared `searchOrganizations`: listed clubs by name or city, for the picker. */
export const Route = createFileRoute("/api/v1/orgs/search")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/orgs/search",
      auth: "user",
      summary: "Search clubs by name or city",
      input: inputSchema,
      output: organizationSearchSchema,
      handler: async ({ ctx, input }) => {
        const { supabase } = requireContext(ctx);
        return searchOrganizations({ supabase }, input.query);
      },
    }),
  },
});
