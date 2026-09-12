import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { claimTeamInviteResultSchema } from "@/lib/api/team-guardians-schema";
import { claimGuardianInvite, claimTeamInviteInput } from "@/lib/team-guardians.server";

/**
 * Thin wrapper over the shared `claimGuardianInvite` (PRD §7.7, Appendix A).
 * `[idem]`: a retried claim never double-links. Creates a parent profile for
 * the caller if they have none — for any signed-in role, as on the web —
 * seeded from the token's `user_metadata` name. The app refreshes `/me` and
 * the parent settings afterwards. 404 `not_found` for an unknown or used
 * invite, 409 `conflict` when expired, already the primary, or the athlete
 * is at the guardian cap. 20/hour per user.
 */
export const Route = createFileRoute("/api/v1/team-invites/claim")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/team-invites/claim",
      operationId: "claimTeamInvite",
      auth: "user",
      idempotent: true,
      rateLimit: { windowSeconds: 3600, max: 20 },
      summary: "Accept a Team plan guardian invite (token or code) as the caller",
      input: claimTeamInviteInput,
      output: claimTeamInviteResultSchema,
      handler: async ({ ctx, input }) => {
        const { admin, userId, claims } = requireContext(ctx);
        return claimGuardianInvite(admin, userId, displayNameFrom(claims?.userMetadata), input);
      },
    }),
  },
});

/** `full_name`, else `first_name [last_name]`, from the token's user metadata. */
function displayNameFrom(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  const full = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  if (full) return full;
  const first = typeof meta.first_name === "string" ? meta.first_name.trim() : "";
  const last = typeof meta.last_name === "string" ? meta.last_name.trim() : "";
  const joined = `${first} ${last}`.trim();
  return joined || null;
}
