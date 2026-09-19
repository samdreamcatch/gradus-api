/**
 * Parent sign-up and onboarding — profile, athletes, coach link, goals,
 * schedule — the single source of truth for the web server functions
 * (parent-signup.functions.ts) and the `/api/v1/signup/parent/*` routes
 * (PRD §7.1 "Parent sign-up", Appendix A). Extracted without behavior
 * changes; user-facing messages are kept verbatim and carried on ApiError.
 */
import { z } from "zod";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SPORT_KEYS } from "@/lib/coach-sports";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { inviteCodeSchema } from "./invites.server";
import { checkRosterRoom } from "./roster-limits";

type Admin = typeof supabaseAdmin;

export type ParentContext = { userId: string; admin: Admin };

/** An invite code, or nothing: blank, null, and absent all mean "no coach". */
export const optionalInviteCodeSchema = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim().toUpperCase() : null))
  .pipe(z.union([inviteCodeSchema, z.null()]));

const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });
const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });

function betaCode(env: NodeJS.ProcessEnv = process.env): string {
  return (env.BETA_INVITE_CODE ?? "").trim().toUpperCase();
}

async function coachIdForCode(admin: Admin, code: string, missing: string): Promise<string> {
  const codeLookup = await admin
    .from("coach_invite_codes")
    .select("coach_id")
    .eq("code", code)
    .maybeSingle();
  if (codeLookup.error) dbError(codeLookup.error);
  if (!codeLookup.data) throw notFound(missing);
  return codeLookup.data.coach_id;
}

export const validateSignupCodeInput = z.object({
  code: inviteCodeSchema,
  role: z.enum(["parent", "coach"]),
});

export type SignupCodeValidation = { kind: "beta" } | { kind: "coach"; coachId: string };

/**
 * `validateSignupCode`: an 8-character code is either a coach's invite or
 * the shared Gradus beta code; coaches may only use the beta code.
 */
export async function validateSignupCode(
  admin: Admin,
  data: z.infer<typeof validateSignupCodeInput>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SignupCodeValidation> {
  const beta = betaCode(env);
  if (beta && data.code === beta) return { kind: "beta" };
  if (data.role === "coach") throw unprocessable("That beta code isn't valid.");
  const coachId = await coachIdForCode(
    admin,
    data.code,
    "That code isn't valid. Check with your coach, or use your Gradus beta code.",
  );
  return { kind: "coach", coachId };
}

export const startParentSignupInput = z.object({
  firstName: z.string().trim().min(1, "First name required").max(80),
  lastName: z.string().trim().min(1, "Last name required").max(80),
  code: optionalInviteCodeSchema,
});

/**
 * `startParentSignup`: create or update the parent profile, linking the
 * coach behind a coach invite code (the beta code links nobody). Returns
 * the coach code so the next screens can look the coach up.
 */
export async function startParentSignup(
  ctx: ParentContext,
  data: z.infer<typeof startParentSignupInput>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: string | null }> {
  const { admin, userId } = ctx;
  const beta = betaCode(env);
  const isBeta = !!(beta && data.code && data.code === beta);

  let coachId: string | null = null;
  let returnedCode: string | null = null;
  if (data.code && !isBeta) {
    coachId = await coachIdForCode(admin, data.code, "That coach invite code isn't valid.");
    returnedCode = data.code;
  }

  const existing = await admin
    .from("parent_profiles")
    .select("id, coach_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.error) dbError(existing.error);

  if (existing.data) {
    const upd = await admin
      .from("parent_profiles")
      .update({
        first_name: data.firstName,
        last_name: data.lastName,
        // Only set coach_id if a new coach code was provided; never clobber
        // an existing link with NULL when the parent re-runs the form.
        ...(coachId ? { coach_id: coachId } : {}),
      })
      .eq("id", existing.data.id);
    if (upd.error) dbError(upd.error);
  } else {
    const ins = await admin.from("parent_profiles").insert({
      user_id: userId,
      first_name: data.firstName,
      last_name: data.lastName,
      coach_id: coachId,
    });
    if (ins.error) dbError(ins.error);
  }

  return { code: returnedCode };
}

export type ParentSignupStatus = {
  hasParentProfile: boolean;
  hasAthletes: boolean;
  hasAnyCoach: boolean;
  inviteCode: string | null;
};

/** `getParentSignupStatus`: where a parent is in sign-up, for resuming the wizard. */
export async function getParentSignupStatus(ctx: ParentContext): Promise<ParentSignupStatus> {
  const { admin, userId } = ctx;
  const parent = await admin
    .from("parent_profiles")
    .select("id, coach_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (parent.error) dbError(parent.error);
  if (!parent.data) {
    return { hasParentProfile: false, hasAthletes: false, hasAnyCoach: false, inviteCode: null };
  }

  const parentId = parent.data.id;

  const [athletes, coachLinks] = await Promise.all([
    admin.from("athletes").select("id").eq("parent_id", parentId).limit(1),
    // Any coach already linked to any of this parent's athletes?
    admin
      .from("coach_athletes")
      .select("coach_id, athletes!inner(parent_id)")
      .eq("athletes.parent_id", parentId)
      .limit(1),
  ]);
  if (athletes.error) dbError(athletes.error);
  if (coachLinks.error) dbError(coachLinks.error);

  let inviteCode: string | null = null;
  if (parent.data.coach_id) {
    const code = await admin
      .from("coach_invite_codes")
      .select("code")
      .eq("coach_id", parent.data.coach_id)
      .maybeSingle();
    if (!code.error && code.data) inviteCode = code.data.code;
  }

  return {
    hasParentProfile: true,
    hasAthletes: (athletes.data ?? []).length > 0,
    hasAnyCoach: (coachLinks.data ?? []).length > 0 || !!parent.data.coach_id,
    inviteCode,
  };
}

export type CoachPreview = {
  coachId: string;
  firstName: string;
  lastName: string;
  sports: string[];
};

/** `getCoachByInviteCode`: who a parent is about to link to, and their sports. */
export async function getCoachByInviteCode(admin: Admin, code: string): Promise<CoachPreview> {
  const coachId = await coachIdForCode(admin, code, "Invalid invite code.");

  const [profile, levels] = await Promise.all([
    admin.from("coach_profiles").select("first_name,last_name").eq("id", coachId).single(),
    admin.from("coach_levels").select("sport").eq("coach_id", coachId),
  ]);
  if (profile.error) dbError(profile.error);

  const sports = Array.from(new Set((levels.data ?? []).map((l) => l.sport)));
  return {
    coachId,
    firstName: profile.data.first_name,
    lastName: profile.data.last_name,
    sports,
  };
}

export const athleteEntrySchema = z.object({
  firstName: z.string().trim().min(1, "Athlete first name required").max(80),
  lastName: z.string().trim().min(1, "Athlete last name required").max(80),
  birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Birthdate required"),
});

export const linkAthletesInput = z.object({
  code: optionalInviteCodeSchema,
  athletes: z.array(athleteEntrySchema).min(1, "Add at least one athlete").max(20),
});

/**
 * `linkAthletesToCoach`: create the parent's athletes and, with a coach
 * code, link each to that coach with every sport the coach offers.
 */
export async function linkAthletesToCoach(
  ctx: ParentContext,
  data: z.infer<typeof linkAthletesInput>,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;

  let coachId: string | null = null;
  if (data.code) coachId = await coachIdForCode(admin, data.code, "Invalid invite code.");

  const parent = await admin
    .from("parent_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (parent.error) dbError(parent.error);
  if (!parent.data) {
    throw unprocessable("Parent profile not found. Please complete signup first.");
  }
  const parentId = parent.data.id;

  if (coachId) {
    // Plan cap: the DB trigger (enforce_coach_roster_cap) is the backstop,
    // but we stop short of it so the parent gets one friendly "Roster full"
    // message up front instead of creating athlete rows we'd have to leave
    // behind, unlinked, when the batch then aborts on a raw database error.
    // These athletes don't exist yet, so none of them can already be on the
    // coach's roster — every one of them is a new link.
    const coachRow = await admin
      .from("coach_profiles")
      .select("organization_id, subscription_tier")
      .eq("id", coachId)
      .maybeSingle();
    if (coachRow.error) dbError(coachRow.error);
    if (coachRow.data) {
      const rosterCount = await admin
        .from("coach_athletes")
        .select("athlete_id", { count: "exact", head: true })
        .eq("coach_id", coachId);
      if (rosterCount.error) dbError(rosterCount.error);
      checkRosterRoom(
        {
          organizationId: coachRow.data.organization_id ?? null,
          subscriptionTier: (coachRow.data.subscription_tier as "coach" | "coach_pro" | null) ?? null,
        },
        rosterCount.count ?? 0,
        data.athletes.length,
      );
    }
  }

  const athleteRows = data.athletes.map((a) => ({
    parent_id: parentId,
    first_name: a.firstName,
    last_name: a.lastName,
    birthdate: a.birthdate,
  }));

  const athletesIns = await admin.from("athletes").insert(athleteRows).select("id");
  if (athletesIns.error) dbError(athletesIns.error);

  if (coachId) {
    // Auto-ack the parent side — the signup wizard's final screen already
    // shows the connection confirmation, so suppress the celebration modal
    // on first load of /parent/plans. The coach still sees theirs.
    const nowIso = new Date().toISOString();
    const linkRows = (athletesIns.data ?? []).map((a) => ({
      coach_id: coachId!,
      athlete_id: a.id,
      other_ack_at: nowIso,
    }));
    const linksIns = await admin.from("coach_athletes").insert(linkRows);
    if (linksIns.error) dbError(linksIns.error);

    // Enable every sport this coach offers for each newly linked athlete.
    const levels = await admin.from("coach_levels").select("sport").eq("coach_id", coachId);
    if (levels.error) dbError(levels.error);
    const sports = Array.from(new Set((levels.data ?? []).map((l) => l.sport)));
    if (sports.length > 0 && (athletesIns.data ?? []).length > 0) {
      const scopeRows = (athletesIns.data ?? []).flatMap((a) =>
        sports.map((sport) => ({ athlete_id: a.id, coach_id: coachId!, sport })),
      );
      const scopeIns = await admin.from("coach_athlete_sports").insert(scopeRows);
      if (scopeIns.error) dbError(scopeIns.error);
    }
  }

  return { ok: true as const };
}

export type AthleteForCode = { id: string; firstName: string; lastName: string };
export type AthletesForCode = {
  coachId: string | null;
  athletes: AthleteForCode[];
  sports: string[];
};

/**
 * `listAthletesForCode`: the parent's athletes linked to the coach behind
 * `code` and that coach's sports; without a code, every athlete and every
 * catalog sport.
 */
export async function listAthletesForCode(
  ctx: ParentContext,
  code: string | null,
): Promise<AthletesForCode> {
  const { admin, userId } = ctx;

  if (!code) {
    // Coach-less path: single query joining athletes to parent_profiles.
    const athletesRes = await admin
      .from("athletes")
      .select("id, first_name, last_name, parent_profiles!inner(user_id)")
      .eq("parent_profiles.user_id", userId)
      .order("created_at", { ascending: true });
    if (athletesRes.error) dbError(athletesRes.error);

    return {
      coachId: null,
      athletes: (athletesRes.data ?? []).map((a) => ({
        id: a.id,
        firstName: a.first_name,
        lastName: a.last_name,
      })),
      sports: [...SPORT_KEYS] as string[],
    };
  }

  // Coached path: parent lookup + code lookup in parallel.
  const [parent, codeLookup] = await Promise.all([
    admin.from("parent_profiles").select("id").eq("user_id", userId).maybeSingle(),
    admin.from("coach_invite_codes").select("coach_id").eq("code", code).maybeSingle(),
  ]);
  if (parent.error) dbError(parent.error);
  if (!parent.data) throw unprocessable("Parent profile not found.");
  if (codeLookup.error) dbError(codeLookup.error);
  if (!codeLookup.data) throw notFound("Invalid invite code.");
  const parentId = parent.data.id;
  const coachId = codeLookup.data.coach_id;

  // Athletes link + coach sports in parallel.
  const [links, levels] = await Promise.all([
    admin
      .from("coach_athletes")
      .select("athlete_id, athletes!inner(id, first_name, last_name, parent_id)")
      .eq("coach_id", coachId),
    admin.from("coach_levels").select("sport").eq("coach_id", coachId),
  ]);
  if (links.error) dbError(links.error);
  if (levels.error) dbError(levels.error);

  const athletes = (links.data ?? [])
    .map(
      (l) =>
        l.athletes as unknown as {
          id: string;
          first_name: string;
          last_name: string;
          parent_id: string;
        },
    )
    .filter((a) => a.parent_id === parentId)
    .map((a) => ({ id: a.id, firstName: a.first_name, lastName: a.last_name }));

  const sports = Array.from(new Set((levels.data ?? []).map((l) => l.sport)));

  return { coachId, athletes, sports };
}

async function assertParentOwnsAthlete(admin: Admin, userId: string, athleteId: string) {
  const athlete = await admin
    .from("athletes")
    .select("id, parent_id, parent_profiles!inner(user_id)")
    .eq("id", athleteId)
    .maybeSingle();
  if (athlete.error) dbError(athlete.error);
  const parentRow = athlete.data?.parent_profiles as unknown as { user_id: string } | undefined;
  if (!athlete.data || parentRow?.user_id !== userId) throw notFound("Athlete not found.");
}

export const athleteGoalsInput = z.object({
  code: optionalInviteCodeSchema,
  athleteId: z.string().uuid(),
  sport: z.string().min(1).max(64),
  currentLevelKey: z.string().min(1).max(64),
  seasonGoalKey: z.string().min(1).max(64),
  longTermGoal: z.string().max(2000).default(""),
});

/** `saveAthleteGoals`: one athlete's level, season target, and long-term goal for a sport. */
export async function saveAthleteGoals(
  ctx: ParentContext,
  data: z.infer<typeof athleteGoalsInput>,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;

  let coachId: string | null = null;
  if (data.code) coachId = await coachIdForCode(admin, data.code, "Invalid invite code.");

  await assertParentOwnsAthlete(admin, userId, data.athleteId);

  let stampCoachId: string | null = coachId;
  if (coachId) {
    // Ensure a primary coach exists for this (athlete, sport).
    const primary = await admin
      .from("athlete_primary_coaches")
      .upsert(
        { athlete_id: data.athleteId, sport: data.sport, coach_id: coachId },
        { onConflict: "athlete_id,sport", ignoreDuplicates: true },
      );
    if (primary.error) dbError(primary.error);

    const resolvedPrimary = await admin
      .from("athlete_primary_coaches")
      .select("coach_id")
      .eq("athlete_id", data.athleteId)
      .eq("sport", data.sport)
      .maybeSingle();
    if (resolvedPrimary.error) dbError(resolvedPrimary.error);
    stampCoachId = resolvedPrimary.data?.coach_id ?? coachId;
  }

  const up = await admin.from("athlete_goals").upsert(
    {
      athlete_id: data.athleteId,
      coach_id: stampCoachId,
      sport: data.sport,
      current_level_key: data.currentLevelKey,
      season_goal_key: data.seasonGoalKey,
      long_term_goal: data.longTermGoal,
    },
    { onConflict: "athlete_id,sport" },
  );
  if (up.error) dbError(up.error);

  const { ensureStarterPrograms } = await import("./starter-programs.server");
  await ensureStarterPrograms(data.athleteId, data.sport, data.currentLevelKey);

  return { ok: true as const };
}

export const lessonSlotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  frequency: z.enum(["weekly", "biweekly", "twice_monthly", "monthly"]).default("weekly"),
  weeksOfMonth: z.array(z.number().int().min(1).max(5)).default([]),
  startsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
});

export const athleteScheduleInput = z.object({
  code: optionalInviteCodeSchema,
  athleteId: z.string().uuid(),
  slots: z.array(lessonSlotSchema).max(20),
});

/** `saveAthleteSchedule`: replace one athlete's lesson slots for this coach (or the coach-less ones). */
export async function saveAthleteSchedule(
  ctx: ParentContext,
  data: z.infer<typeof athleteScheduleInput>,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  for (const s of data.slots) {
    if (s.endMinute <= s.startMinute) throw unprocessable("End time must be after start time.");
  }

  let coachId: string | null = null;
  if (data.code) coachId = await coachIdForCode(admin, data.code, "Invalid invite code.");

  await assertParentOwnsAthlete(admin, userId, data.athleteId);

  // Replace only the rows scoped to this coach (or coach-less rows when
  // no code) so each coach owns their own schedule blocks.
  const delQuery = admin.from("athlete_lesson_slots").delete().eq("athlete_id", data.athleteId);
  const del = await (coachId ? delQuery.eq("coach_id", coachId) : delQuery.is("coach_id", null));
  if (del.error) dbError(del.error);

  if (data.slots.length > 0) {
    const ins = await admin.from("athlete_lesson_slots").insert(
      data.slots.map((s) => ({
        athlete_id: data.athleteId,
        coach_id: coachId,
        day_of_week: s.dayOfWeek,
        start_minute: s.startMinute,
        end_minute: s.endMinute,
        frequency: s.frequency,
        weeks_of_month:
          s.frequency === "biweekly" || s.frequency === "weekly" ? [] : s.weeksOfMonth,
        starts_on: s.frequency === "biweekly" ? s.startsOn : null,
      })),
    );
    if (ins.error) dbError(ins.error);
  }
  return { ok: true as const };
}

// Crockford-style base32 minus I, L, O, 0, 1 (matches the web's genCode alphabet).
const PARENT_INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++)
    out += PARENT_INVITE_ALPHABET[bytes[i] % PARENT_INVITE_ALPHABET.length];
  return out;
}

/** `getOrCreateParentInviteCode`: the parent's code coaches use to join their athletes. */
export async function getOrCreateParentInviteCode(ctx: ParentContext): Promise<{ code: string }> {
  const { admin, userId } = ctx;

  const parent = await admin
    .from("parent_profiles")
    .select("id, promo_code")
    .eq("user_id", userId)
    .maybeSingle();
  if (parent.error) dbError(parent.error);
  if (!parent.data) throw unprocessable("Parent profile not found.");
  const parentId = parent.data.id;
  const inviterPromo = parent.data.promo_code ?? null;

  const existing = await admin
    .from("parent_invite_codes")
    .select("code")
    .eq("parent_id", parentId)
    .maybeSingle();
  if (existing.error) dbError(existing.error);
  if (existing.data) return { code: existing.data.code };

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = genCode(8);
    const ins = await admin
      .from("parent_invite_codes")
      .insert({ parent_id: parentId, code, promo_code: inviterPromo })
      .select("code")
      .maybeSingle();
    if (!ins.error && ins.data) return { code: ins.data.code };
    // Collision on either parent_id (race) or code: re-read parent's row.
    const reread = await admin
      .from("parent_invite_codes")
      .select("code")
      .eq("parent_id", parentId)
      .maybeSingle();
    if (reread.data) return { code: reread.data.code };
  }
  throw new ApiError({
    code: "internal",
    status: 500,
    message: "Could not generate a unique invite code.",
  });
}
