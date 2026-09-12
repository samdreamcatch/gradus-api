import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rethrowPlain } from "./api/errors";
import {
  claimAthleteSelf as claimAthleteSelfImpl,
  claimAthleteSelfInput,
  claimGuardianAthlete as claimGuardianAthleteImpl,
  claimGuardianAthleteInput,
  getGuardianClaimContext as getGuardianClaimContextImpl,
  getGuardianClaimMergeOptions as getGuardianClaimMergeOptionsImpl,
  getGuardianClaimMergeOptionsInput,
  getGuardianClaimSummary as getGuardianClaimSummaryImpl,
  getGuardianClaimSummaryInput,
  getMyGuardianStatus as getMyGuardianStatusImpl,
  mergeGuardianClaim as mergeGuardianClaimImpl,
  mergeGuardianClaimInput,
  resendGuardianInvite as resendGuardianInviteImpl,
  resendGuardianInviteInput,
} from "./guardian-claim.server";

// Re-export so existing web imports keep working.
export { guardianEmailSchema } from "./guardian-claim.server";
export type {
  GuardianClaimContextDTO,
  GuardianClaimResultDTO,
  GuardianClaimSummaryDTO,
  GuardianMergeOptionDTO,
  GuardianMergeOptionsDTO,
  GuardianStatusDTO,
  ResendGuardianInviteResultDTO,
} from "./guardian-claim.server";

/**
 * Guardian claim flow (`/g/:token`) and the athlete's guardian-on-file row.
 *
 * Thin wrappers over the shared entry points in
 * src/lib/guardian-claim.server.ts, shared with the `/api/v1/guardian/…`
 * routes (PRD §3.5, Appendix A). Names, methods, input schemas, return
 * types and error messages are unchanged.
 */
async function getAdmin() {
  const m = await import("@/integrations/supabase/client.server");
  return m.supabaseAdmin;
}

/**
 * Public summary for a guardian claim link. Returns only the athlete's first
 * name and the coach who added them — enough to recognize the athlete, never
 * enough to enumerate accounts.
 */
export const getGuardianClaimSummary = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => getGuardianClaimSummaryInput.parse(input))
  .handler(async ({ data }) => {
    try {
      return await getGuardianClaimSummaryImpl(await getAdmin(), data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/**
 * Attach the athlete behind a claim token to the signed-in user's parent
 * profile, creating the parent profile when it doesn't exist yet. The athlete
 * keeps their own login; the parent simply gains full visibility through the
 * normal parent_id relationship.
 */
export const claimGuardianAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => claimGuardianAthleteInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await claimGuardianAthleteImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/**
 * Re-send the guardian invite (or change the address on file). Callable by the
 * athlete themselves or by any coach with the athlete on their roster.
 */
export const resendGuardianInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => resendGuardianInviteInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await resendGuardianInviteImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/** Guardian status for the signed-in athlete's own row (drives the banner). */
export const getMyGuardianStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await getMyGuardianStatusImpl(await getAdmin(), context.userId);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/** Who the signed-in claimer is, so the page doesn't ask a returning parent to re-introduce themselves. */
export const getGuardianClaimContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await getGuardianClaimContextImpl(await getAdmin(), context.userId);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/**
 * The signed-in claimer's OWN athletes, ranked by how closely they match the
 * pending athlete behind this token. Only their own data is returned, so this
 * discloses nothing about anyone else's account.
 */
export const getGuardianClaimMergeOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => getGuardianClaimMergeOptionsInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await getGuardianClaimMergeOptionsImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/**
 * "That's my existing athlete" — move the coach's link and lessons from the
 * pending athlete onto one of the claimer's own athletes, then delete the
 * pending row so no duplicate survives.
 */
export const mergeGuardianClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => mergeGuardianClaimInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await mergeGuardianClaimImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/**
 * Adult-athlete path for a coach invite: the signed-in user IS the athlete, so
 * attach the pending athlete row to their own account instead of a parent's.
 */
export const claimAthleteSelf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => claimAthleteSelfInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await claimAthleteSelfImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });
