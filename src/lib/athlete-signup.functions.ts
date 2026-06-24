import { createServerFn } from "@tanstack/react-start";
import { getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(8, "Invite code must be 8 characters")
  .regex(/^[A-Z2-9]+$/, "Invalid characters in code");

// Rate-limit knobs for the public invite-code lookup. Tuned to allow a
// legitimate athlete a handful of typos but make name-enumeration impractical.
const RATE_WINDOW_SECONDS = 60;
const RATE_MAX_PER_WINDOW = 10;

function clientIp(): string {
  try {
    const ip = getRequestIP({ xForwardedFor: true });
    if (ip) return ip;
  } catch {
    // ignore
  }
  // Fallback: hash of UA to at least bucket non-IP callers.
  const ua = (() => {
    try {
      return getRequestHeader("user-agent") ?? "";
    } catch {
      return "";
    }
  })();
  return `ua:${ua.slice(0, 64)}`;
}

/**
 * Public lookup: resolve an athlete invite code to a preview of the athlete,
 * the coach, and the sports they work on together. No auth required —
 * holding the code is the credential. Rate-limited per IP to prevent
 * brute-force enumeration of athlete/coach PII.
 */
export const getAthleteInviteSummary = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ip = clientIp();

    // Atomic check-and-insert via a SECURITY DEFINER function that holds a
    // transaction-scoped advisory lock keyed by IP. This serializes
    // concurrent requests from the same IP and closes the TOCTOU window
    // that a parallel check-then-insert pattern would leave open.
    const limit = await supabaseAdmin.rpc("record_invite_lookup_attempt", {
      _ip: ip,
      _code: data.code,
      _max_per_window: RATE_MAX_PER_WINDOW,
      _window_seconds: RATE_WINDOW_SECONDS,
    });
    if (limit.error) dbError(limit.error);
    if (limit.data === -1) {
      throw new Error("Too many attempts. Please wait a minute and try again.");
    }

    const codeRow = await supabaseAdmin
      .from("athlete_invite_codes")
      .select("athlete_id, parent_id, used_at, expires_at, claimed_by")
      .eq("code", data.code)
      .maybeSingle();
    if (codeRow.error) dbError(codeRow.error);
    if (!codeRow.data) throw new Error("That code isn't valid. Double-check with your parent.");
    if (codeRow.data.used_at) throw new Error("This code has already been used.");
    if (new Date(codeRow.data.expires_at) < new Date()) {
      throw new Error("This code has expired. Ask your parent for a new one.");
    }


    const athlete = await supabaseAdmin
      .from("athletes")
      .select("id, first_name, last_name")
      .eq("id", codeRow.data.athlete_id)
      .single();
    if (athlete.error) dbError(athlete.error);

    const link = await supabaseAdmin
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
        ? supabaseAdmin
            .from("coach_profiles")
            .select("first_name, last_name")
            .eq("id", coachId)
            .single()
        : Promise.resolve({ data: null, error: null } as const),
      supabaseAdmin
        .from("athlete_goals")
        .select("sport")
        .eq("athlete_id", athlete.data.id),
      coachId
        ? supabaseAdmin.from("coach_levels").select("sport").eq("coach_id", coachId)
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
  });

/**
 * Claim an athlete invite for the currently signed-in user: bind
 * `athletes.user_id` to `auth.uid()` and mark the code consumed. Idempotent
 * when called again by the same user.
 */
export const claimAthleteInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const codeRow = await supabaseAdmin
      .from("athlete_invite_codes")
      .select("id, athlete_id, used_at, expires_at, claimed_by")
      .eq("code", data.code)
      .maybeSingle();
    if (codeRow.error) dbError(codeRow.error);
    if (!codeRow.data) throw new Error("That code isn't valid.");
    if (new Date(codeRow.data.expires_at) < new Date()) {
      throw new Error("This code has expired.");
    }
    if (codeRow.data.used_at && codeRow.data.claimed_by !== userId) {
      throw new Error("This code has already been used.");
    }

    // Read current ownership first, then update with a structured guard.
    // Avoids interpolating userId into a raw PostgREST filter string.
    const existing = await supabaseAdmin
      .from("athletes")
      .select("user_id")
      .eq("id", codeRow.data.athlete_id)
      .single();
    if (existing.error) dbError(existing.error);
    if (existing.data.user_id && existing.data.user_id !== userId) {
      throw new Error("This athlete is already linked to another account.");
    }
    if (!existing.data.user_id) {
      const upd = await supabaseAdmin
        .from("athletes")
        .update({ user_id: userId })
        .eq("id", codeRow.data.athlete_id)
        .is("user_id", null); // race guard
      if (upd.error) dbError(upd.error);
    }


    if (!codeRow.data.used_at) {
      const stamp = await supabaseAdmin
        .from("athlete_invite_codes")
        .update({ used_at: new Date().toISOString(), claimed_by: userId, claimed_at: new Date().toISOString() })
        .eq("id", codeRow.data.id);
      if (stamp.error) dbError(stamp.error);
    }

    return { ok: true, athleteId: codeRow.data.athlete_id };
  });

/**
 * Returns the signed-in athlete's own row (used by the /athlete page).
 */
export const getMyAthlete = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    const row = await supabaseAdmin
      .from("athletes")
      .select("id, first_name, last_name")
      .eq("user_id", userId)
      .maybeSingle();
    if (row.error) dbError(row.error);
    if (!row.data) return null;
    return { id: row.data.id, firstName: row.data.first_name, lastName: row.data.last_name };
  });

// ---------------------------------------------------------------------------
// Username / password signup (no email)
// ---------------------------------------------------------------------------
//
// Athletes are often kids without their own email address. We let them sign
// up with a globally-unique username + password. Auth still goes through
// Supabase, so we mint a synthetic email of the form
// `athlete-{athleteId}@users.gradus.training` that's stored in auth.users
// but never used to deliver mail — account recovery is the parent's job
// (see resetAthletePassword in parent-settings.functions.ts).

const SYNTHETIC_EMAIL_DOMAIN = "users.gradus.training";
function syntheticEmail(athleteId: string): string {
  return `athlete-${athleteId}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Username must be at least 3 characters")
  .max(24, "Username must be at most 24 characters")
  .regex(/^[a-z0-9_]+$/, "Use only lowercase letters, numbers, and underscores");

/**
 * Public: check whether a username is free. Rate-limited per IP using the
 * same bucket as invite-code lookups to keep enumeration impractical.
 */
export const checkAthleteUsername = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ username: usernameSchema }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const limit = await supabaseAdmin.rpc("record_invite_lookup_attempt", {
      _ip: clientIp(),
      _code: `u:${data.username}`,
      _max_per_window: RATE_MAX_PER_WINDOW,
      _window_seconds: RATE_WINDOW_SECONDS,
    });
    if (limit.error) dbError(limit.error);
    if (limit.data === -1) {
      throw new Error("Too many attempts. Please wait a minute and try again.");
    }
    const row = await supabaseAdmin
      .from("athletes")
      .select("id")
      .eq("username", data.username)
      .maybeSingle();
    if (row.error) dbError(row.error);
    return { available: !row.data };
  });

/**
 * Public: claim an invite code with a username + password. Creates the auth
 * user (synthetic email, pre-confirmed), binds the username + user_id to
 * the athlete row, marks the code consumed. Returns the synthetic email so
 * the client can immediately sign in. Username and email uniqueness are
 * both enforced — collisions surface as a friendly message.
 */
export const signupAthleteWithUsername = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        code: codeSchema,
        username: usernameSchema,
        password: z.string().min(8, "Password must be at least 8 characters"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Validate invite
    const codeRow = await supabaseAdmin
      .from("athlete_invite_codes")
      .select("id, athlete_id, used_at, expires_at")
      .eq("code", data.code)
      .maybeSingle();
    if (codeRow.error) dbError(codeRow.error);
    if (!codeRow.data) throw new Error("That code isn't valid.");
    if (codeRow.data.used_at) throw new Error("This code has already been used.");
    if (new Date(codeRow.data.expires_at) < new Date()) {
      throw new Error("This code has expired. Ask your parent for a new one.");
    }

    const athleteId = codeRow.data.athlete_id as string;

    // 2. Reserve the username up-front (cheap collision check; the unique
    //    index is the real guard).
    const existingUsername = await supabaseAdmin
      .from("athletes")
      .select("id")
      .eq("username", data.username)
      .maybeSingle();
    if (existingUsername.error) dbError(existingUsername.error);
    if (existingUsername.data) throw new Error("That username is already taken.");

    // 3. Check the athlete isn't already bound to a user (a previous
    //    half-finished signup, for example).
    const athleteRow = await supabaseAdmin
      .from("athletes")
      .select("user_id")
      .eq("id", athleteId)
      .single();
    if (athleteRow.error) dbError(athleteRow.error);
    if (athleteRow.data.user_id) {
      throw new Error("This athlete is already linked to an account.");
    }

    // 4. Create the auth user with a synthetic email, pre-confirmed.
    const email = syntheticEmail(athleteId);
    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { athlete_id: athleteId, username: data.username },
    });
    if (created.error || !created.data.user) {
      throw new Error(created.error?.message ?? "Couldn't create account.");
    }
    const newUserId = created.data.user.id;

    // 5. Bind to athlete row (race-guarded). If this fails, roll back the
    //    auth user to avoid orphaned auth accounts.
    const upd = await supabaseAdmin
      .from("athletes")
      .update({ user_id: newUserId, username: data.username })
      .eq("id", athleteId)
      .is("user_id", null);
    if (upd.error) {
      await supabaseAdmin.auth.admin.deleteUser(newUserId).catch(() => {});
      // Unique-violation on athletes.username — race for the same name.
      if ((upd.error as { code?: string }).code === "23505") {
        throw new Error("That username was just taken. Try another.");
      }
      dbError(upd.error);
    }

    // 6. Burn the invite.
    const stamp = await supabaseAdmin
      .from("athlete_invite_codes")
      .update({
        used_at: new Date().toISOString(),
        claimed_by: newUserId,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", codeRow.data.id);
    if (stamp.error) dbError(stamp.error);

    return { email, athleteId };
  });

/**
 * Public: resolve a username to the synthetic email used for sign-in. Used
 * by the login screen when the user types something without an `@`. Rate-
 * limited per IP to prevent username enumeration.
 */
export const resolveAthleteLogin = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ username: usernameSchema }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const limit = await supabaseAdmin.rpc("record_invite_lookup_attempt", {
      _ip: clientIp(),
      _code: `l:${data.username}`,
      _max_per_window: RATE_MAX_PER_WINDOW,
      _window_seconds: RATE_WINDOW_SECONDS,
    });
    if (limit.error) dbError(limit.error);
    if (limit.data === -1) {
      throw new Error("Too many attempts. Please wait a minute and try again.");
    }
    const row = await supabaseAdmin
      .from("athletes")
      .select("id")
      .eq("username", data.username)
      .maybeSingle();
    if (row.error) dbError(row.error);
    if (!row.data) throw new Error("No account found with that username.");
    return { email: syntheticEmail(row.data.id) };
  });
