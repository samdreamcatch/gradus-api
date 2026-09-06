/**
 * Minor athlete sign-up — the parent-issued invite code, the identity
 * preview, claiming, and the username + password account — the single
 * source of truth for the web server functions (athlete-signup.functions.ts)
 * and the `/api/v1/signup/athlete/*` and `/api/v1/athlete/me` routes
 * (PRD §7.1 "Athlete (minor) sign-up", Appendix A). Extracted without
 * behavior changes; user-facing messages are kept verbatim on ApiError.
 */
import { z } from "zod";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { syntheticEmailForAthlete, usernameSchema } from "./api/auth-broker";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { inviteCodeSchema, throttleLookup } from "./invites.server";

type Admin = typeof supabaseAdmin;

// Tuned to allow a legitimate athlete a handful of typos but make
// name-enumeration impractical (the web's RATE_MAX_PER_WINDOW).
const LOOKUP_MAX_PER_WINDOW = 10;

const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });
const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });

export type AthleteInviteSummary = {
  athleteFirstName: string;
  athleteLastName: string;
  coachFirstName: string | null;
  coachLastName: string | null;
  sports: string[];
};

/**
 * `getAthleteInviteSummary`: who the code is for, their coach if any, and
 * the sports they work on. Holding the code is the credential; per-IP
 * throttled so athlete and coach names cannot be enumerated.
 */
export async function getAthleteInviteSummary(
  admin: Admin,
  ip: string,
  code: string,
): Promise<AthleteInviteSummary> {
  await throttleLookup(admin, ip, code, LOOKUP_MAX_PER_WINDOW);

  const codeRow = await admin
    .from("athlete_invite_codes")
    .select("athlete_id, parent_id, used_at, expires_at, claimed_by")
    .eq("code", code)
    .maybeSingle();
  if (codeRow.error) dbError(codeRow.error);
  if (!codeRow.data) throw notFound("That code isn't valid. Double-check with your parent.");
  if (codeRow.data.used_at) throw unprocessable("This code has already been used.");
  if (codeRow.data.expires_at && new Date(codeRow.data.expires_at) < new Date()) {
    throw unprocessable("This code has expired. Ask your parent for a new one.");
  }

  const athlete = await admin
    .from("athletes")
    .select("id, first_name, last_name")
    .eq("id", codeRow.data.athlete_id)
    .single();
  if (athlete.error) dbError(athlete.error);

  const link = await admin
    .from("coach_athletes")
    .select("coach_id")
    .eq("athlete_id", athlete.data.id)
    .limit(1)
    .maybeSingle();
  if (link.error) dbError(link.error);
  const coachId = link.data?.coach_id ?? null;

  // Coach is optional: a parent may invite an athlete before connecting a
  // coach. Sports fall back to the athlete's own goals when no coach is
  // linked yet.
  const [coach, goals, levels] = await Promise.all([
    coachId
      ? admin.from("coach_profiles").select("first_name, last_name").eq("id", coachId).single()
      : Promise.resolve({ data: null, error: null } as const),
    admin.from("athlete_goals").select("sport").eq("athlete_id", athlete.data.id),
    coachId
      ? admin.from("coach_levels").select("sport").eq("coach_id", coachId)
      : Promise.resolve({ data: [] as { sport: string }[], error: null } as const),
  ]);
  if (coach.error) dbError(coach.error);

  const goalSports = Array.from(new Set((goals.data ?? []).map((g) => g.sport)));
  const sports =
    goalSports.length > 0
      ? goalSports
      : Array.from(new Set((levels.data ?? []).map((l) => l.sport)));

  return {
    athleteFirstName: athlete.data.first_name,
    athleteLastName: athlete.data.last_name,
    coachFirstName: coach.data?.first_name ?? null,
    coachLastName: coach.data?.last_name ?? null,
    sports,
  };
}

/**
 * `claimAthleteInvite`: bind the athlete row to the signed-in user and
 * consume the code. Idempotent for the same user.
 */
export async function claimAthleteInvite(
  ctx: { userId: string; admin: Admin },
  code: string,
): Promise<{ ok: true; athleteId: string }> {
  const { admin, userId } = ctx;

  const codeRow = await admin
    .from("athlete_invite_codes")
    .select("id, athlete_id, used_at, expires_at, claimed_by")
    .eq("code", code)
    .maybeSingle();
  if (codeRow.error) dbError(codeRow.error);
  if (!codeRow.data) throw notFound("That code isn't valid.");
  if (codeRow.data.expires_at && new Date(codeRow.data.expires_at) < new Date()) {
    throw unprocessable("This code has expired.");
  }
  if (codeRow.data.used_at && codeRow.data.claimed_by !== userId) {
    throw unprocessable("This code has already been used.");
  }

  // Read current ownership first, then update with a structured guard.
  const existing = await admin
    .from("athletes")
    .select("user_id")
    .eq("id", codeRow.data.athlete_id)
    .single();
  if (existing.error) dbError(existing.error);
  if (existing.data.user_id && existing.data.user_id !== userId) {
    throw unprocessable("This athlete is already linked to another account.");
  }
  if (!existing.data.user_id) {
    const upd = await admin
      .from("athletes")
      .update({ user_id: userId })
      .eq("id", codeRow.data.athlete_id)
      .is("user_id", null); // race guard
    if (upd.error) dbError(upd.error);
  }

  if (!codeRow.data.used_at) {
    const stamp = await admin
      .from("athlete_invite_codes")
      .update({
        used_at: new Date().toISOString(),
        claimed_by: userId,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", codeRow.data.id);
    if (stamp.error) dbError(stamp.error);
  }

  return { ok: true as const, athleteId: codeRow.data.athlete_id };
}

export type MyAthlete = { id: string; firstName: string; lastName: string };

/** `getMyAthlete`: the signed-in athlete's own row, or null. */
export async function getMyAthlete(ctx: {
  userId: string;
  admin: Admin;
}): Promise<MyAthlete | null> {
  const row = await ctx.admin
    .from("athletes")
    .select("id, first_name, last_name")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (row.error) dbError(row.error);
  if (!row.data) return null;
  return { id: row.data.id, firstName: row.data.first_name, lastName: row.data.last_name };
}

export const usernameSignupInput = z.object({
  code: inviteCodeSchema,
  username: usernameSchema,
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/**
 * `signupAthleteWithUsername`: claim an invite with a username and password.
 * Creates the auth user under a synthetic, pre-confirmed email, binds it to
 * the athlete row, and burns the code. Returns the synthetic email so the
 * client can sign in at once.
 */
export async function signupAthleteWithUsername(
  admin: Admin,
  data: z.infer<typeof usernameSignupInput>,
): Promise<{ email: string; athleteId: string }> {
  // 1. Validate invite
  const codeRow = await admin
    .from("athlete_invite_codes")
    .select("id, athlete_id, used_at, expires_at")
    .eq("code", data.code)
    .maybeSingle();
  if (codeRow.error) dbError(codeRow.error);
  if (!codeRow.data) throw notFound("That code isn't valid.");
  if (codeRow.data.used_at) throw unprocessable("This code has already been used.");
  if (codeRow.data.expires_at && new Date(codeRow.data.expires_at) < new Date()) {
    throw unprocessable("This code has expired. Ask your parent for a new one.");
  }

  const athleteId = codeRow.data.athlete_id as string;

  // 2. Reserve the username up-front (cheap collision check; the unique
  //    index is the real guard).
  const existingUsername = await admin
    .from("athletes")
    .select("id")
    .eq("username", data.username)
    .maybeSingle();
  if (existingUsername.error) dbError(existingUsername.error);
  if (existingUsername.data) throw unprocessable("That username is already taken.");

  // 3. Check the athlete isn't already bound to a user (a previous
  //    half-finished signup, for example).
  const athleteRow = await admin.from("athletes").select("user_id").eq("id", athleteId).single();
  if (athleteRow.error) dbError(athleteRow.error);
  if (athleteRow.data.user_id) throw unprocessable("This athlete is already linked to an account.");

  // 4. Create the auth user with a synthetic email, pre-confirmed.
  const email = syntheticEmailForAthlete(athleteId);
  const created = await admin.auth.admin.createUser({
    email,
    password: data.password,
    email_confirm: true,
    user_metadata: { athlete_id: athleteId, username: data.username },
  });
  if (created.error || !created.data.user) {
    throw unprocessable(created.error?.message ?? "Couldn't create account.");
  }
  const newUserId = created.data.user.id;

  // 5. Bind to athlete row (race-guarded). If this fails, roll back the
  //    auth user to avoid orphaned auth accounts.
  const upd = await admin
    .from("athletes")
    .update({ user_id: newUserId, username: data.username })
    .eq("id", athleteId)
    .is("user_id", null);
  if (upd.error) {
    await admin.auth.admin.deleteUser(newUserId).catch(() => {});
    // Unique-violation on athletes.username — race for the same name.
    if ((upd.error as { code?: string }).code === "23505") {
      throw unprocessable("That username was just taken. Try another.");
    }
    dbError(upd.error);
  }

  // 6. Burn the invite.
  const stamp = await admin
    .from("athlete_invite_codes")
    .update({
      used_at: new Date().toISOString(),
      claimed_by: newUserId,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", codeRow.data.id);
  if (stamp.error) dbError(stamp.error);

  return { email, athleteId };
}
