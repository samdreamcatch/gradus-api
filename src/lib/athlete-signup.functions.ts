import { createServerFn } from "@tanstack/react-start";
import { getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import {
  claimAthleteInvite as claimAthleteInviteShared,
  getAthleteInviteSummary as getAthleteInviteSummaryShared,
  getMyAthlete as getMyAthleteShared,
  signupAthleteWithUsername as signupAthleteWithUsernameShared,
  usernameSignupInput,
} from "./athlete-signup.server";

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(8, "Enter the full invite code")
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

/*
 * Invite lookup, claim, and username sign-up are thin wrappers over
 * src/lib/athlete-signup.server.ts, shared with the /api/v1/signup/athlete/*
 * routes (PRD §6.2). Behavior is unchanged.
 */

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
    return getAthleteInviteSummaryShared(supabaseAdmin, clientIp(), data.code);
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
    return claimAthleteInviteShared({ userId: context.userId, admin: supabaseAdmin }, data.code);
  });

/**
 * Returns the signed-in athlete's own row (used by the /athlete page).
 */
export const getMyAthlete = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return getMyAthleteShared({ userId: context.userId, admin: supabaseAdmin });
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
  .inputValidator((input: unknown) => z.object({ username: usernameSchema }).parse(input))
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
 * the client can immediately sign in.
 */
export const signupAthleteWithUsername = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => usernameSignupInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return signupAthleteWithUsernameShared(supabaseAdmin, data);
  });

/**
 * Public: resolve a username to the synthetic email used for sign-in. Used
 * by the login screen when the user types something without an `@`. Rate-
 * limited per IP to prevent username enumeration.
 */
export const resolveAthleteLogin = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ username: usernameSchema }).parse(input))
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
