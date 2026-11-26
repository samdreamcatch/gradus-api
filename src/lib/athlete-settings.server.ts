/**
 * The athlete's own settings (PRD §7.12, Appendix A "Parent and athlete
 * settings"): their row with the guardian-on-file state, and the self-edit
 * of name and birthdate — the single source of truth for the web server
 * functions (athlete-settings.functions.ts) and `GET /api/v1/athlete/settings`
 * / `PATCH /api/v1/athlete/me`. Extracted without behavior changes.
 *
 * Reads and writes go through the admin client keyed on the caller's
 * `user_id`, as on the web.
 */
import { z } from "zod";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";

type Admin = typeof supabaseAdmin;

export type AthleteSettingsContext = { userId: string; admin: Admin };

/**
 * API-only strictness (PRD §6.2 stable codes). The web wrapper leaves this
 * off and keeps its original behavior, per PRD §4.1 rule 1.
 */
export type AthleteSelfOptions = {
  /**
   * 404 `not_found` for a caller with no athlete row (instead of a silent
   * no-op), and 422 `unprocessable` when the `enforce_adult_self_managed`
   * trigger rejects the birthdate (instead of the generic 500 the web's
   * generic toast maps to).
   */
  apiContract?: boolean;
};

const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });
const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });

/** Same message `createSelfManagedAthlete` gives the trigger's check violation (adult-athlete.server.ts). */
export const UNDER_18_NEEDS_GUARDIAN = "Athletes under 18 need a parent or guardian email.";

/** An athlete cannot change a birthdate that is already on file (RLS audit, 2026-11-19). */
export const BIRTHDATE_LOCKED = "Your birthdate can't be changed. Contact support if it's wrong.";

export type AthleteSettingsDTO = {
  id: string;
  firstName: string;
  lastName: string;
  birthdate: string | null;
  username: string | null;
  guardianEmail: string | null;
  guardianInvitedAt: string | null;
  /** A guardian "on file" becomes a guardian "in app" once they claim the athlete or the athlete is attached to a parent profile. */
  guardianClaimed: boolean;
  /** PRD §6.13 A4: `provisional` until a guardian claims a 13–17 self-sign-up. */
  accountState: "active" | "provisional" | "paused";
};

export const athleteSelfInput = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  birthdate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});
export type AthleteSelfInput = z.infer<typeof athleteSelfInput>;

/** The caller's settings, or null when they have no athlete row. */
export async function getAthleteSettings(
  ctx: AthleteSettingsContext,
): Promise<AthleteSettingsDTO | null> {
  const { userId, admin } = ctx;
  const row = await admin
    .from("athletes")
    .select(
      "id, first_name, last_name, birthdate, username, parent_id, guardian_email, guardian_invited_at, guardian_claimed_at, account_state",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (row.error) dbError(row.error);
  if (!row.data) return null;
  return {
    id: row.data.id,
    firstName: row.data.first_name,
    lastName: row.data.last_name,
    birthdate: (row.data.birthdate as string | null) ?? null,
    username: (row.data as { username: string | null }).username ?? null,
    guardianEmail: (row.data.guardian_email as string | null) ?? null,
    guardianInvitedAt: (row.data.guardian_invited_at as string | null) ?? null,
    // A guardian "on file" becomes a guardian "in app" once they claim the
    // athlete or the athlete is attached to a parent profile.
    guardianClaimed: Boolean(row.data.guardian_claimed_at) || Boolean(row.data.parent_id),
    accountState:
      ((row.data as { account_state?: string | null }).account_state as
        | "active"
        | "provisional"
        | "paused"
        | null
        | undefined) ?? "active",
  };
}

/** Update the caller's own name, and set their birthdate if none is on file. See `AthleteSelfOptions` for the API's stricter answers. */
export async function updateAthleteSelf(
  ctx: AthleteSettingsContext,
  input: AthleteSelfInput,
  opts: AthleteSelfOptions = {},
): Promise<{ ok: true }> {
  const { userId, admin } = ctx;
  const row = await admin
    .from("athletes")
    .select("id, birthdate")
    .eq("user_id", userId)
    .maybeSingle();
  if (row.error) dbError(row.error);
  if (!row.data && opts.apiContract) throw notFound("Athlete not found");
  // A birthdate is entered once. Age gates read it, so an athlete who could
  // change it could make themselves an adult. A row with none on file (a
  // coach-added athlete) may still set it the first time.
  const onFile = (row.data?.birthdate as string | null | undefined) ?? null;
  if (onFile !== null && input.birthdate !== onFile) throw unprocessable(BIRTHDATE_LOCKED);
  const upd = await admin
    .from("athletes")
    .update({
      first_name: input.firstName,
      last_name: input.lastName,
      ...(onFile === null ? { birthdate: input.birthdate } : {}),
    })
    .eq("user_id", userId);
  if (upd.error) {
    // 23514 = check_violation: the age trigger (a self-managed athlete's
    // birthdate moved under 18 with no guardian on file).
    if (opts.apiContract && (upd.error as { code?: string }).code === "23514") {
      throw unprocessable(UNDER_18_NEEDS_GUARDIAN);
    }
    dbError(upd.error);
  }
  return { ok: true };
}
