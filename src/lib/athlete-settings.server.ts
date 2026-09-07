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
import { dbError } from "./db-error";

type Admin = typeof supabaseAdmin;

export type AthleteSettingsContext = { userId: string; admin: Admin };

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
      "id, first_name, last_name, birthdate, username, parent_id, guardian_email, guardian_invited_at, guardian_claimed_at",
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
  };
}

/** Update the caller's own name and birthdate. */
export async function updateAthleteSelf(
  ctx: AthleteSettingsContext,
  input: AthleteSelfInput,
): Promise<{ ok: true }> {
  const { userId, admin } = ctx;
  const upd = await admin
    .from("athletes")
    .update({
      first_name: input.firstName,
      last_name: input.lastName,
      birthdate: input.birthdate,
    })
    .eq("user_id", userId);
  if (upd.error) dbError(upd.error);
  return { ok: true };
}
