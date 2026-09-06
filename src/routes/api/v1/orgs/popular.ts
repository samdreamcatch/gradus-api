import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { popularOrganizationsSchema } from "@/lib/api/onboarding-schema";
import { getPopularOrganizations } from "@/lib/orgs.server";

/** Thin wrapper over the shared `getPopularOrganizations`: the clubs with the most coaches, for the empty search state. */
export const Route = createFileRoute("/api/v1/orgs/popular")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/orgs/popular",
      auth: "user",
      summary: "Popular clubs",
      output: popularOrganizationsSchema,
      handler: async ({ ctx }) => getPopularOrganizations(requireContext(ctx).admin),
    }),
  },
});
