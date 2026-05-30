import { createServerFn } from "@tanstack/react-start";
import { getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
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
    const ip = clientIp();

    // Count recent attempts from this IP.
    const since = new Date(Date.now() - RATE_WINDOW_SECONDS * 1000).toISOString();
    const recent = await supabaseAdmin
      .from("invite_lookup_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("attempted_at", since);
    if ((recent.count ?? 0) >= RATE_MAX_PER_WINDOW) {
      throw new Error("Too many attempts. Please wait a minute and try again.");
    }

    // Log this attempt (fire-and-forget on failure — never block the user).
    await supabaseAdmin
      .from("invite_lookup_attempts")
      .insert({ ip, code: data.code, found: false });

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
    if (!link.data) throw new Error("No coach is linked to this athlete yet.");
    const coachId = link.data.coach_id;

    const [coach, goals, levels] = await Promise.all([
      supabaseAdmin
        .from("coach_profiles")
        .select("first_name, last_name")
        .eq("id", coachId)
        .single(),
      supabaseAdmin
        .from("athlete_goals")
        .select("sport")
        .eq("athlete_id", athlete.data.id)
        .eq("coach_id", coachId),
      supabaseAdmin.from("coach_levels").select("sport").eq("coach_id", coachId),
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
      coachFirstName: coach.data.first_name,
      coachLastName: coach.data.last_name,
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

    // Bind athlete to this user
    const upd = await supabaseAdmin
      .from("athletes")
      .update({ user_id: userId })
      .eq("id", codeRow.data.athlete_id)
      .or(`user_id.is.null,user_id.eq.${userId}`);
    if (upd.error) dbError(upd.error);

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
