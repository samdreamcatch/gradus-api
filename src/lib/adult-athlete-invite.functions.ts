import { createServerFn } from "@tanstack/react-start";
import { getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import { ageInYears } from "./pending-athlete-dob";

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(8, "Invite code must be 8 characters")
  .regex(/^[A-Z2-9]+$/, "Invalid characters in code");

const RATE_WINDOW_SECONDS = 60;
const RATE_MAX_PER_WINDOW = 10;

// Crockford-style base32, minus I, L, O, 0, 1.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function clientIp(): string {
  try {
    const ip = getRequestIP({ xForwardedFor: true });
    if (ip) return ip;
  } catch {
    /* ignore */
  }
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
 * Returns the signed-in adult (self-managed) athlete's invite code, creating
 * one on first use. Coaches use this code (or link) to roster this athlete.
 */
export const getOrCreateAdultAthleteInviteCode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const me = await supabaseAdmin
      .from("athletes")
      .select("id, self_managed, promo_code, birthdate, guardian_email")
      .eq("user_id", userId)
      .maybeSingle();
    if (me.error) dbError(me.error);
    if (!me.data || !me.data.self_managed) {
      throw new Error("Only self-managed athletes can create an invite code.");
    }
    // Under-18 athletes can invite a coach, but only with a guardian on file.
    const bd = me.data.birthdate as string | null;
    if (bd && ageInYears(bd) < 18 && !me.data.guardian_email) {
      throw new Error("Add a parent or guardian email in Settings before inviting a coach.");
    }
    const athleteId = me.data.id;
    const inviterPromo = me.data.promo_code ?? null;

    const existing = await supabaseAdmin
      .from("adult_athlete_invite_codes")
      .select("code")
      .eq("athlete_id", athleteId)
      .maybeSingle();
    if (existing.error) dbError(existing.error);
    if (existing.data) return { code: existing.data.code };

    for (let attempt = 0; attempt < 8; attempt++) {
      const code = generateCode();
      const ins = await supabaseAdmin
        .from("adult_athlete_invite_codes")
        .insert({ athlete_id: athleteId, code, promo_code: inviterPromo })
        .select("code")
        .maybeSingle();
      if (!ins.error && ins.data) return { code: ins.data.code };
      const reread = await supabaseAdmin
        .from("adult_athlete_invite_codes")
        .select("code")
        .eq("athlete_id", athleteId)
        .maybeSingle();
      if (reread.data) return { code: reread.data.code };
    }
    throw new Error("Could not generate a unique invite code.");
  });

/**
 * Public: preview the athlete an adult-athlete invite belongs to. Rate-limited
 * per IP. Used by /signup/coach so the coach sees who they're linking to.
 */
export const getAdultAthleteByInviteCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const limit = await supabaseAdmin.rpc("record_invite_lookup_attempt", {
      _ip: clientIp(),
      _code: data.code,
      _max_per_window: RATE_MAX_PER_WINDOW,
      _window_seconds: RATE_WINDOW_SECONDS,
    });
    if (limit.error) dbError(limit.error);
    if (limit.data === -1) {
      throw new Error("Too many attempts. Please wait a minute and try again.");
    }

    const lookup = await supabaseAdmin.rpc("get_adult_athlete_by_invite_code", {
      _code: data.code,
    });
    if (lookup.error) dbError(lookup.error);
    const row = (lookup.data ?? [])[0];
    if (!row) throw new Error("That adult-athlete invite code isn't valid.");
    return {
      athleteId: row.athlete_id as string,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
    };
  });

/**
 * Called by an authenticated, onboarded coach to claim an adult-athlete
 * invite. Links the coach to just this one athlete, enables every sport the
 * coach offers, and sets primary coach for those sports when missing.
 * Idempotent.
 */
export const claimAdultAthleteInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: codeSchema,
        // When true, marks the coach side as already acknowledged so the
        // celebration modal doesn't appear on the coach's first page load
        // after the signup wizard. Used by /signup/coach?invite=...
        autoAckCoach: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const coach = await supabaseAdmin
      .from("coach_profiles")
      .select("id, promo_code")
      .eq("user_id", userId)
      .maybeSingle();
    if (coach.error) dbError(coach.error);
    if (!coach.data) throw new Error("Coach profile not found.");
    const coachId = coach.data.id;

    const inviteRow = await supabaseAdmin
      .from("adult_athlete_invite_codes")
      .select("athlete_id, promo_code")
      .eq("code", data.code)
      .maybeSingle();
    if (inviteRow.error) dbError(inviteRow.error);
    if (!inviteRow.data) throw new Error("That adult-athlete invite code isn't valid.");
    const athleteId = inviteRow.data.athlete_id;

    // Propagate the athlete's promo code onto the coach for attribution and
    // Stripe checkout discount. First-invite-wins.
    if (inviteRow.data.promo_code && !coach.data.promo_code) {
      await supabaseAdmin
        .from("coach_profiles")
        .update({ promo_code: inviteRow.data.promo_code })
        .eq("id", coachId)
        .is("promo_code", null);
    }

    const ackIso = data.autoAckCoach ? new Date().toISOString() : null;
    const linkIns = await supabaseAdmin.from("coach_athletes").upsert(
      [
        {
          coach_id: coachId,
          athlete_id: athleteId,
          ...(ackIso ? { coach_ack_at: ackIso } : {}),
        },
      ],
      { onConflict: "coach_id,athlete_id", ignoreDuplicates: true },
    );
    if (linkIns.error) dbError(linkIns.error);

    const levelsRes = await supabaseAdmin
      .from("coach_levels")
      .select("sport")
      .eq("coach_id", coachId);
    if (levelsRes.error) dbError(levelsRes.error);
    const coachSports = Array.from(new Set((levelsRes.data ?? []).map((l) => l.sport)));
    if (coachSports.length === 0) return { ok: true, sports: 0 };

    const scopeRows = coachSports.map((sport) => ({
      athlete_id: athleteId,
      coach_id: coachId,
      sport,
    }));
    const scopeIns = await supabaseAdmin.from("coach_athlete_sports").upsert(scopeRows, {
      onConflict: "athlete_id,coach_id,sport",
      ignoreDuplicates: true,
    });
    if (scopeIns.error) dbError(scopeIns.error);

    const primaryRows = coachSports.map((sport) => ({
      athlete_id: athleteId,
      sport,
      coach_id: coachId,
    }));
    const primaryIns = await supabaseAdmin.from("athlete_primary_coaches").upsert(primaryRows, {
      onConflict: "athlete_id,sport",
      ignoreDuplicates: true,
    });
    if (primaryIns.error) dbError(primaryIns.error);

    return { ok: true, sports: coachSports.length };
  });
