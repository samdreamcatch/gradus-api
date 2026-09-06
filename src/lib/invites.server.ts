/**
 * Invite codes — resolving the universal `/i/:code` entry, previewing and
 * claiming parent and adult-athlete invites as a coach, and the coach's own
 * shareable code. Single source of truth for the web server functions
 * (invite-resolve, parent-signup, adult-athlete-invite, coach-invite) and
 * the `/api/v1/invites/*` and `/api/v1/coach/invite-code` routes (PRD §6.2,
 * Appendix A). Extracted without behavior changes; user-facing messages are
 * kept verbatim and carried on ApiError so the API gets stable codes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;
type Admin = typeof supabaseAdmin;

/** 8 characters from the lookalike-free alphabet; lowercase input is accepted. */
export const inviteCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(8, "Invite code must be 8 characters")
  .regex(/^[A-Z2-9]+$/, "Invalid characters in code");

// Crockford-style base32, minus I, L, O, 0, 1 to avoid lookalikes.
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const MAX_ATTEMPTS = 12;

const RATE_WINDOW_SECONDS = 60;
const RESOLVE_MAX_PER_WINDOW = 15;
const PARENT_PREVIEW_MAX_PER_WINDOW = 15;
const ADULT_PREVIEW_MAX_PER_WINDOW = 10;

const TOO_MANY = "Too many attempts. Please wait a minute and try again.";

function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += INVITE_CODE_ALPHABET[bytes[i] % INVITE_CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Per-IP lookup throttle backed by `record_invite_lookup_attempt` (same
 * RPC and limits as the web). `-1` means the window is exhausted.
 */
export async function throttleLookup(admin: Admin, ip: string, key: string, maxPerWindow: number) {
  const limit = await admin.rpc("record_invite_lookup_attempt", {
    _ip: ip,
    _code: key,
    _max_per_window: maxPerWindow,
    _window_seconds: RATE_WINDOW_SECONDS,
  });
  if (limit.error) dbError(limit.error);
  if (limit.data === -1) {
    throw new ApiError({
      code: "rate_limited",
      status: 429,
      message: TOO_MANY,
      details: { retryAfterSeconds: RATE_WINDOW_SECONDS },
    });
  }
}

export type InviteKind = "coach" | "parent" | "athlete" | "adult-athlete" | "guardian";

export type InviteResolution =
  | { kind: "coach"; valid: true; promoCode: null }
  | { kind: "parent"; valid: true; promoCode: string | null }
  | { kind: "adult-athlete"; valid: true; promoCode: string | null }
  | { kind: "athlete"; valid: boolean; used: boolean; expired: boolean; promoCode: null }
  | {
      kind: "guardian";
      valid: boolean;
      used: boolean;
      guardianToken: string | null;
      promoCode: null;
    }
  | { kind: null; valid: false; promoCode: null };

/**
 * `resolveInviteCode`: which table an 8-char code belongs to, so the entry
 * screen knows where to send the recipient. Rate-limited per IP.
 */
export async function resolveInviteCode(
  admin: Admin,
  ip: string,
  code: string,
): Promise<InviteResolution> {
  await throttleLookup(admin, ip, `r:${code}`, RESOLVE_MAX_PER_WINDOW);

  const [coach, parent, athlete, adultAthlete, guardian] = await Promise.all([
    admin.from("coach_invite_codes").select("code").eq("code", code).maybeSingle(),
    admin.from("parent_invite_codes").select("code, promo_code").eq("code", code).maybeSingle(),
    admin
      .from("athlete_invite_codes")
      .select("code, used_at, expires_at")
      .eq("code", code)
      .maybeSingle(),
    admin
      .from("adult_athlete_invite_codes")
      .select("code, promo_code")
      .eq("code", code)
      .maybeSingle(),
    admin
      .from("athletes")
      .select("guardian_claim_token, parent_id, guardian_claimed_at")
      .eq("guardian_claim_code", code)
      .maybeSingle(),
  ]);
  if (coach.error) dbError(coach.error);
  if (parent.error) dbError(parent.error);
  if (athlete.error) dbError(athlete.error);
  if (adultAthlete.error) dbError(adultAthlete.error);
  if (guardian.error) dbError(guardian.error);

  /** Only surface a promo that's still active — the signup screen shows it. */
  const activePromo = async (promo: string | null) => {
    if (!promo) return null;
    const { data: row } = await admin
      .from("promo_codes")
      .select("code, active")
      .eq("code", promo)
      .maybeSingle();
    return row?.active ? row.code : null;
  };

  if (coach.data) return { kind: "coach", valid: true, promoCode: null };
  if (parent.data) {
    return {
      kind: "parent",
      valid: true,
      promoCode: await activePromo(parent.data.promo_code ?? null),
    };
  }
  if (adultAthlete.data) {
    return {
      kind: "adult-athlete",
      valid: true,
      promoCode: await activePromo(adultAthlete.data.promo_code ?? null),
    };
  }
  if (athlete.data) {
    const expired = athlete.data.expires_at
      ? new Date(athlete.data.expires_at) < new Date()
      : false;
    return {
      kind: "athlete",
      valid: !athlete.data.used_at && !expired,
      used: !!athlete.data.used_at,
      expired,
      promoCode: null,
    };
  }
  if (guardian.data) {
    const claimed = Boolean(guardian.data.parent_id || guardian.data.guardian_claimed_at);
    return {
      kind: "guardian",
      valid: !claimed && !!guardian.data.guardian_claim_token,
      used: claimed,
      guardianToken: (guardian.data.guardian_claim_token as string | null) ?? null,
      promoCode: null,
    };
  }
  return { kind: null, valid: false, promoCode: null };
}

export type ParentInvitePreview = {
  parentId: string;
  firstName: string;
  lastName: string;
  athleteCount: number;
};

/** `getParentByInviteCode`: who a coach is about to link to. Rate-limited per IP. */
export async function previewParentInvite(
  admin: Admin,
  ip: string,
  code: string,
): Promise<ParentInvitePreview> {
  await throttleLookup(admin, ip, code, PARENT_PREVIEW_MAX_PER_WINDOW);

  const lookup = await admin.rpc("get_parent_by_invite_code", { _code: code });
  if (lookup.error) dbError(lookup.error);
  const row = (lookup.data ?? [])[0];
  if (!row) {
    throw new ApiError({
      code: "not_found",
      status: 404,
      message: "That parent invite code isn't valid.",
    });
  }
  return {
    parentId: row.parent_id as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    athleteCount: row.athlete_count as number,
  };
}

export type AdultAthleteInvitePreview = { athleteId: string; firstName: string; lastName: string };

/** `getAdultAthleteByInviteCode`. Rate-limited per IP. */
export async function previewAdultAthleteInvite(
  admin: Admin,
  ip: string,
  code: string,
): Promise<AdultAthleteInvitePreview> {
  await throttleLookup(admin, ip, code, ADULT_PREVIEW_MAX_PER_WINDOW);

  const lookup = await admin.rpc("get_adult_athlete_by_invite_code", { _code: code });
  if (lookup.error) dbError(lookup.error);
  const row = (lookup.data ?? [])[0];
  if (!row) {
    throw new ApiError({
      code: "not_found",
      status: 404,
      message: "That adult-athlete invite code isn't valid.",
    });
  }
  return {
    athleteId: row.athlete_id as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
  };
}

export const claimInviteInput = z.object({
  code: inviteCodeSchema,
  // When true, marks the coach side as already acknowledged so the
  // celebration modal doesn't appear on the coach's first page load
  // after the signup wizard. Used by /signup/coach?invite=...
  autoAckCoach: z.boolean().optional(),
});

export type CoachClaimContext = { userId: string; admin: Admin };

const coachProfileMissing = () =>
  new ApiError({ code: "unprocessable", status: 422, message: "Coach profile not found." });

/**
 * `claimParentInvite`: an authenticated, onboarded coach claims a parent
 * invite. Links every athlete under the parent, enables every sport the
 * coach offers, fills coach-less goals/slots, and sets primary coaches.
 * Idempotent.
 */
export async function claimParentInvite(
  ctx: CoachClaimContext,
  data: z.infer<typeof claimInviteInput>,
): Promise<{ ok: true; athletes: number; sports: number }> {
  const { admin, userId } = ctx;

  const coach = await admin
    .from("coach_profiles")
    .select("id, promo_code")
    .eq("user_id", userId)
    .maybeSingle();
  if (coach.error) dbError(coach.error);
  if (!coach.data) throw coachProfileMissing();
  const coachId = coach.data.id;

  const inviteRow = await admin
    .from("parent_invite_codes")
    .select("parent_id, promo_code")
    .eq("code", data.code)
    .maybeSingle();
  if (inviteRow.error) dbError(inviteRow.error);
  if (!inviteRow.data) {
    throw new ApiError({
      code: "not_found",
      status: 404,
      message: "That parent invite code isn't valid.",
    });
  }
  const parentId = inviteRow.data.parent_id;

  // Propagate the inviter's promo code onto the coach's own row so it
  // becomes their attribution + auto-applies at Stripe checkout.
  // First-invite-wins: only stamp when the coach doesn't already have one.
  if (inviteRow.data.promo_code && !coach.data.promo_code) {
    await admin
      .from("coach_profiles")
      .update({ promo_code: inviteRow.data.promo_code })
      .eq("id", coachId)
      .is("promo_code", null);
  }

  // Athletes under this parent
  const athletesRes = await admin.from("athletes").select("id").eq("parent_id", parentId);
  if (athletesRes.error) dbError(athletesRes.error);
  const athleteIds = (athletesRes.data ?? []).map((a) => a.id);
  if (athleteIds.length === 0) return { ok: true as const, athletes: 0, sports: 0 };

  // Sports this coach offers
  const levelsRes = await admin.from("coach_levels").select("sport").eq("coach_id", coachId);
  if (levelsRes.error) dbError(levelsRes.error);
  const coachSports = Array.from(new Set((levelsRes.data ?? []).map((l) => l.sport)));

  // 1. coach_athletes (skip duplicates). Ack coach side when the caller
  //    is the signup wizard (celebration modal would duplicate the
  //    wizard's own confirmation screen).
  const ackIso = data.autoAckCoach ? new Date().toISOString() : null;
  const linkRows = athleteIds.map((athlete_id) => ({
    coach_id: coachId,
    athlete_id,
    ...(ackIso ? { coach_ack_at: ackIso } : {}),
  }));
  const linksIns = await admin
    .from("coach_athletes")
    .upsert(linkRows, { onConflict: "coach_id,athlete_id", ignoreDuplicates: true });
  if (linksIns.error) dbError(linksIns.error);

  if (coachSports.length === 0) {
    return { ok: true as const, athletes: athleteIds.length, sports: 0 };
  }

  // 2. coach_athlete_sports for each (athlete, sport)
  const scopeRows = athleteIds.flatMap((athlete_id) =>
    coachSports.map((sport) => ({ athlete_id, coach_id: coachId, sport })),
  );
  const scopeIns = await admin
    .from("coach_athlete_sports")
    .upsert(scopeRows, { onConflict: "athlete_id,coach_id,sport", ignoreDuplicates: true });
  if (scopeIns.error) dbError(scopeIns.error);

  // 3. Fill coach_id on pending parent-owned goals/slots that match a
  //    sport this coach offers.
  const goalsUpd = await admin
    .from("athlete_goals")
    .update({ coach_id: coachId })
    .in("athlete_id", athleteIds)
    .in("sport", coachSports)
    .is("coach_id", null);
  if (goalsUpd.error) dbError(goalsUpd.error);

  const slotsUpd = await admin
    .from("athlete_lesson_slots")
    .update({ coach_id: coachId })
    .in("athlete_id", athleteIds)
    .is("coach_id", null);
  if (slotsUpd.error) dbError(slotsUpd.error);

  // 4. athlete_primary_coaches — set missing (athlete, sport) → coach.
  const primaryRows = athleteIds.flatMap((athlete_id) =>
    coachSports.map((sport) => ({ athlete_id, sport, coach_id: coachId })),
  );
  const primaryIns = await admin
    .from("athlete_primary_coaches")
    .upsert(primaryRows, { onConflict: "athlete_id,sport", ignoreDuplicates: true });
  if (primaryIns.error) dbError(primaryIns.error);

  return { ok: true as const, athletes: athleteIds.length, sports: coachSports.length };
}

/**
 * `claimAdultAthleteInvite`: links the coach to just this one athlete,
 * enables every sport the coach offers, sets primary coach where missing.
 * Idempotent.
 */
export async function claimAdultAthleteInvite(
  ctx: CoachClaimContext,
  data: z.infer<typeof claimInviteInput>,
): Promise<{ ok: true; sports: number }> {
  const { admin, userId } = ctx;

  const coach = await admin
    .from("coach_profiles")
    .select("id, promo_code")
    .eq("user_id", userId)
    .maybeSingle();
  if (coach.error) dbError(coach.error);
  if (!coach.data) throw coachProfileMissing();
  const coachId = coach.data.id;

  const inviteRow = await admin
    .from("adult_athlete_invite_codes")
    .select("athlete_id, promo_code")
    .eq("code", data.code)
    .maybeSingle();
  if (inviteRow.error) dbError(inviteRow.error);
  if (!inviteRow.data) {
    throw new ApiError({
      code: "not_found",
      status: 404,
      message: "That adult-athlete invite code isn't valid.",
    });
  }
  const athleteId = inviteRow.data.athlete_id;

  // Propagate the athlete's promo code onto the coach for attribution and
  // Stripe checkout discount. First-invite-wins.
  if (inviteRow.data.promo_code && !coach.data.promo_code) {
    await admin
      .from("coach_profiles")
      .update({ promo_code: inviteRow.data.promo_code })
      .eq("id", coachId)
      .is("promo_code", null);
  }

  const ackIso = data.autoAckCoach ? new Date().toISOString() : null;
  const linkIns = await admin.from("coach_athletes").upsert(
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

  const levelsRes = await admin.from("coach_levels").select("sport").eq("coach_id", coachId);
  if (levelsRes.error) dbError(levelsRes.error);
  const coachSports = Array.from(new Set((levelsRes.data ?? []).map((l) => l.sport)));
  if (coachSports.length === 0) return { ok: true as const, sports: 0 };

  const scopeRows = coachSports.map((sport) => ({
    athlete_id: athleteId,
    coach_id: coachId,
    sport,
  }));
  const scopeIns = await admin.from("coach_athlete_sports").upsert(scopeRows, {
    onConflict: "athlete_id,coach_id,sport",
    ignoreDuplicates: true,
  });
  if (scopeIns.error) dbError(scopeIns.error);

  const primaryRows = coachSports.map((sport) => ({
    athlete_id: athleteId,
    sport,
    coach_id: coachId,
  }));
  const primaryIns = await admin.from("athlete_primary_coaches").upsert(primaryRows, {
    onConflict: "athlete_id,sport",
    ignoreDuplicates: true,
  });
  if (primaryIns.error) dbError(primaryIns.error);

  return { ok: true as const, sports: coachSports.length };
}

// --- The coach's own shareable code ----------------------------------------

export type CoachCodeContext = { userId: string; supabase: Client };

const codeGenerationFailed = () =>
  new ApiError({
    code: "internal",
    status: 500,
    message: "Could not generate a unique invite code",
  });

async function ensureCoachId(supabase: Client, userId: string): Promise<string> {
  const existing = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.error) dbError(existing.error);
  if (existing.data) return existing.data.id;

  const created = await supabase
    .from("coach_profiles")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (created.error) dbError(created.error);
  return created.data.id;
}

async function insertUniqueCode(supabase: Client, coachId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateCode();
    const { error } = await supabase.from("coach_invite_codes").insert({ coach_id: coachId, code });
    if (!error) return code;
    // 23505 = unique_violation — collision on either coach_id or code.
    // If it's the coach_id, fall through; the caller re-reads.
    if (error.code !== "23505") dbError(error);
    const existing = await supabase
      .from("coach_invite_codes")
      .select("code")
      .eq("coach_id", coachId)
      .maybeSingle();
    if (existing.data) return existing.data.code;
    // Otherwise it was a code collision — retry.
  }
  throw codeGenerationFailed();
}

async function updateUniqueCode(supabase: Client, coachId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateCode();
    const { error } = await supabase
      .from("coach_invite_codes")
      .update({ code })
      .eq("coach_id", coachId);
    if (!error) return code;
    if (error.code !== "23505") dbError(error);
    // code collision — retry
  }
  throw codeGenerationFailed();
}

/** `getCoachInviteCode`: the persistent code, created on first use. */
export async function getCoachInviteCode(ctx: CoachCodeContext): Promise<{ code: string }> {
  const { supabase, userId } = ctx;
  const coachId = await ensureCoachId(supabase, userId);

  const existing = await supabase
    .from("coach_invite_codes")
    .select("code")
    .eq("coach_id", coachId)
    .maybeSingle();
  if (existing.error) dbError(existing.error);
  if (existing.data) return { code: existing.data.code };

  const code = await insertUniqueCode(supabase, coachId);
  return { code };
}

/** `rotateCoachInviteCode`: replaces the code; old links stop working. */
export async function rotateCoachInviteCode(ctx: CoachCodeContext): Promise<{ code: string }> {
  const { supabase, userId } = ctx;
  const coachId = await ensureCoachId(supabase, userId);

  // Ensure a row exists first so UPDATE has something to hit.
  const existing = await supabase
    .from("coach_invite_codes")
    .select("id")
    .eq("coach_id", coachId)
    .maybeSingle();
  if (existing.error) dbError(existing.error);
  if (!existing.data) {
    const code = await insertUniqueCode(supabase, coachId);
    return { code };
  }

  const code = await updateUniqueCode(supabase, coachId);
  return { code };
}
