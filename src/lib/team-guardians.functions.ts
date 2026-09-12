/**
 * Team plan — co-guardian management.
 *
 * A primary parent on an active Team plan can invite additional parents or
 * guardians to an athlete. Invitees accept by link (token) or by entering the
 * invite code in their own settings. Co-guardians get full parity with the
 * primary parent while the plan is active, and go view-only if it lapses.
 *
 * Thin wrappers over the shared entry points in
 * src/lib/team-guardians.server.ts, shared with the `/api/v1` team routes
 * (PRD §7.7, Appendix A). Behavior and error messages are unchanged.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rethrowPlain } from "./api/errors";
import {
  claimGuardianInvite as claimGuardianInviteImpl,
  claimTeamInviteInput,
  inviteGuardian as inviteGuardianImpl,
  inviteGuardianInput,
  listTeamGuardians as listTeamGuardiansImpl,
  previewGuardianInvite as previewGuardianInviteImpl,
  previewTeamInviteInput,
  removeGuardian as removeGuardianImpl,
  removeGuardianInput,
  resendTeamGuardianInvite as resendTeamGuardianInviteImpl,
  resendTeamGuardianInviteInput,
  revokeGuardianInvite as revokeGuardianInviteImpl,
  revokeGuardianInviteInput,
} from "./team-guardians.server";

// Re-export types so web imports can name the DTOs.
export type {
  ClaimTeamInviteResultDTO,
  InviteGuardianResultDTO,
  TeamGuardianAthleteDTO,
  TeamGuardianDTO,
  TeamGuardianInviteDTO,
  TeamGuardiansDTO,
  TeamInvitePreviewDTO,
} from "./team-guardians.server";

async function getAdmin() {
  const m = await import("@/integrations/supabase/client.server");
  return m.supabaseAdmin;
}

/** Guardians + pending invites for each athlete the caller is primary on. */
export const listTeamGuardians = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await listTeamGuardiansImpl(await getAdmin(), context.userId);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/** Create a guardian invite (optionally emailing it). Requires an active plan. */
export const inviteGuardian = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inviteGuardianInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await inviteGuardianImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/** Re-send a pending invite's email (same code and token). No web caller yet. */
export const resendTeamGuardianInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => resendTeamGuardianInviteInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await resendTeamGuardianInviteImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const revokeGuardianInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => revokeGuardianInviteInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await revokeGuardianInviteImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/** Remove a co-guardian. Primary parents cannot be removed. */
export const removeGuardian = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => removeGuardianInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await removeGuardianImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/**
 * Public-ish preview of an invite (token or code) so the claim page can
 * render. Same `{ found: false } | { found: true, athleteName, inviterName }`
 * shape the page always got; the API answers the flat nullable form.
 */
export const previewGuardianInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => previewTeamInviteInput.parse(input))
  .handler(async ({ data }) => {
    try {
      const out = await previewGuardianInviteImpl(await getAdmin(), null, data);
      if (!out.found) return { found: false as const };
      return {
        found: true as const,
        athleteName: out.athleteName ?? "an athlete",
        inviterName: out.inviterName ?? "A parent",
      };
    } catch (err) {
      rethrowPlain(err);
    }
  });

/** Accept an invite as the signed-in parent. Creates a parent profile if needed. */
export const claimGuardianInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => claimTeamInviteInput.parse(input))
  .handler(async ({ data, context }) => {
    // Same name source the web always used for a first-time parent profile.
    const meta = (context.claims as Record<string, any> | undefined) ?? {};
    const displayName: string | null = meta["name"] ?? meta["user_metadata"]?.full_name ?? null;
    try {
      return await claimGuardianInviteImpl(await getAdmin(), context.userId, displayName, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });
