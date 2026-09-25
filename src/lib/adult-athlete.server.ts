/**
 * Self-managed (adult) athletes — profile creation, coach links by invite
 * code, goals, coach list and sport scoping, lesson schedules — the single
 * source of truth for the web server functions (adult-athlete-signup.functions.ts,
 * adult-athlete-schedule.functions.ts) and the `/api/v1/signup/adult-athlete`
 * and `/api/v1/adult-athlete/*` routes (PRD §7.1 "Adult athlete sign-up",
 * Appendix A). Extracted without behavior changes; messages verbatim.
 *
 * Reads and writes go through the caller's RLS client, as on the web: the
 * self-managed policies and triggers are the real gate.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { currentGoalValues, recordGoalsChange } from "./goals-history.server";
import { inviteCodeSchema } from "./invites.server";
import { lessonSlotSchema } from "./parent-signup.server";
import { ageInYears } from "./pending-athlete-dob";
import { isUnderThirteen } from "./guardian-verification.server";

type Client = SupabaseClient<Database>;
type Admin = typeof supabaseAdmin;

export type AdultContext = { userId: string; supabase: Client; admin: Admin };

const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });
const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });

const nameSchema = z.string().trim().min(1, "Required").max(60, "Too long");

export const birthdateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter your date of birth")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      !Number.isNaN(dt.getTime()) &&
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }, "Enter a valid date")
  .refine((v) => ageInYears(v) < 120, "Enter a valid date");

export const createSelfManagedAthleteInput = z
  .object({
    firstName: nameSchema,
    lastName: nameSchema,
    birthdate: birthdateSchema,
    guardianEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email("Enter a valid parent or guardian email")
      .max(255)
      .optional(),
  })
  .refine((v) => ageInYears(v.birthdate) >= 18 || Boolean(v.guardianEmail), {
    message: "Athletes under 18 need a parent or guardian email.",
    path: ["guardianEmail"],
  });

/**
 * `createSelfManagedAthlete`: the caller's own athlete row. Idempotent: an
 * existing self-managed row is returned unchanged. Minors need a guardian
 * email; the guardian is emailed a claim link.
 */
export async function createSelfManagedAthlete(
  ctx: Pick<AdultContext, "userId" | "supabase">,
  data: z.infer<typeof createSelfManagedAthleteInput>,
): Promise<{ athleteId: string }> {
  const { supabase, userId } = ctx;
  const isMinor = ageInYears(data.birthdate) < 18;

  // Decision #30 (PRD §6.13 A4): no under-13 athlete ever creates their own
  // account; the parent starts it and the child joins with the parent's code.
  if (isUnderThirteen(data.birthdate)) {
    throw new ApiError({
      code: "parent_required",
      status: 422,
      message:
        "Athletes under 13 need a parent or guardian to set up their account. Ask them to sign up for Gradus and add you.",
    });
  }

  // Idempotent: don't error if the user already has a row (e.g. the signup
  // form was submitted twice, or they returned to onboarding).
  const existing = await supabase
    .from("athletes")
    .select("id, self_managed")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.error) dbError(existing.error);
  if (existing.data) {
    if (!existing.data.self_managed) {
      throw unprocessable("This account is already registered as a parent-managed athlete.");
    }
    return { athleteId: existing.data.id };
  }

  const { newGuardianToken, sendGuardianInvite } = await import("./guardian.server");
  const guardianEmail = isMinor ? (data.guardianEmail ?? null) : null;
  const guardianToken = guardianEmail ? newGuardianToken() : null;

  const insert = await supabase
    .from("athletes")
    .insert({
      first_name: data.firstName,
      last_name: data.lastName,
      birthdate: data.birthdate,
      self_managed: true,
      parent_id: null,
      user_id: userId,
      guardian_email: guardianEmail,
      guardian_claim_token: guardianToken,
      guardian_invited_at: guardianEmail ? new Date().toISOString() : null,
      // Decision #31: a 13–17 self-sign-up waits on a verified guardian.
      account_state: isMinor ? "provisional" : "active",
    })
    .select("id")
    .single();
  if (insert.error) {
    // 23514 = check_violation (age trigger). Give a friendly message.
    if ((insert.error as { code?: string }).code === "23514") {
      throw unprocessable("Athletes under 18 need a parent or guardian email.");
    }
    dbError(insert.error);
  }

  if (guardianEmail && guardianToken) {
    await sendGuardianInvite({
      to: guardianEmail,
      athleteName: `${data.firstName} ${data.lastName}`.trim(),
      token: guardianToken,
    });
  }

  return { athleteId: insert.data.id };
}

/**
 * Any athlete with their own login may connect coaches. The requirement is a
 * reachable guardian, not self-management: adults need nothing, minors need
 * either a guardian email on file or a linked parent account.
 */
export function athleteCanConnectCoach(row: {
  birthdate: string | null;
  guardian_email: string | null;
  parent_id: string | null;
  account_state?: string | null;
}): boolean {
  // PRD §6.13 A4: a provisional (unclaimed 13–17) or paused account never connects a coach.
  const state = row.account_state ?? "active";
  if (state === "provisional" || state === "paused") return false;
  const minor = row.birthdate ? ageInYears(row.birthdate) < 18 : false;
  if (!minor) return true;
  return Boolean(row.guardian_email) || Boolean(row.parent_id);
}

function assertCanConnectCoach(row: {
  birthdate: string | null;
  guardian_email: string | null;
  parent_id: string | null;
  account_state?: string | null;
}) {
  if (athleteCanConnectCoach(row)) return;
  const state = row.account_state ?? "active";
  if (state === "provisional") {
    throw new ApiError({
      code: "provisional",
      status: 403,
      message:
        "Your parent or guardian needs to claim your account before you can connect a coach. Check that they got the email, or resend it from Settings.",
    });
  }
  if (state === "paused") {
    throw new ApiError({ code: "paused", status: 403, message: "This account is paused." });
  }
  throw unprocessable("Add a parent or guardian email in Settings before connecting a coach.");
}

async function coachIdForCode(admin: Admin, code: string): Promise<string> {
  const codeLookup = await admin
    .from("coach_invite_codes")
    .select("coach_id")
    .eq("code", code)
    .maybeSingle();
  if (codeLookup.error) dbError(codeLookup.error);
  if (!codeLookup.data)
    throw notFound("That invite code isn't valid. Double-check with the coach.");
  return codeLookup.data.coach_id;
}

async function offeredSports(admin: Admin, coachId: string): Promise<Set<string>> {
  const offered = await admin.from("coach_levels").select("sport").eq("coach_id", coachId);
  if (offered.error) dbError(offered.error);
  return new Set((offered.data ?? []).map((r) => r.sport));
}

export type AdultCoachPreview = { coachId: string; coachName: string; sports: string[] };

/** `previewCoachForAdultAthlete`: the coach behind a code, for a signed-in athlete. */
export async function previewCoachForAdultAthlete(
  ctx: AdultContext,
  code: string,
): Promise<AdultCoachPreview> {
  const { admin, userId } = ctx;
  const me = await admin
    .from("athletes")
    .select("id, self_managed, birthdate, guardian_email, parent_id, account_state")
    .eq("user_id", userId)
    .maybeSingle();
  if (me.error) dbError(me.error);
  if (!me.data) throw unprocessable("Finish setting up your athlete profile first.");
  assertCanConnectCoach(me.data);

  const coachId = await coachIdForCode(admin, code);
  const [profile, levels] = await Promise.all([
    admin.from("coach_profiles").select("first_name, last_name").eq("id", coachId).single(),
    admin.from("coach_levels").select("sport").eq("coach_id", coachId),
  ]);
  if (profile.error) dbError(profile.error);
  const sports = Array.from(new Set((levels.data ?? []).map((l) => l.sport)));
  return {
    coachId,
    coachName: `${profile.data.first_name} ${profile.data.last_name}`.trim(),
    sports,
  };
}

export const linkAdultCoachInput = z.object({
  code: inviteCodeSchema,
  sports: z.array(z.string().min(1).max(64)).min(1, "Pick at least one sport").max(20),
});

/** `linkAdultAthleteToCoach`: roster the caller with a coach for the chosen sports. */
export async function linkAdultAthleteToCoach(
  ctx: AdultContext,
  data: z.infer<typeof linkAdultCoachInput>,
): Promise<{ ok: true; coachId: string }> {
  const { admin, supabase, userId } = ctx;

  // Resolve the caller's self-managed athlete.
  const me = await supabase
    .from("athletes")
    .select("id, self_managed, birthdate, guardian_email, parent_id, account_state")
    .eq("user_id", userId)
    .maybeSingle();
  if (me.error) dbError(me.error);
  if (!me.data) throw unprocessable("Finish setting up your athlete profile first.");
  assertCanConnectCoach(me.data);
  const athleteId = me.data.id;

  // Resolve the coach code (admin: codes are opaque, no RLS gate needed).
  const coachId = await coachIdForCode(admin, data.code);

  // Validate selected sports are actually offered by this coach.
  const offeredSet = await offeredSports(admin, coachId);
  const chosen = Array.from(new Set(data.sports));
  for (const s of chosen) {
    if (!offeredSet.has(s)) throw unprocessable(`Coach doesn't offer ${s}.`);
  }

  // Don't double-link.
  const existing = await supabase
    .from("coach_athletes")
    .select("id")
    .eq("athlete_id", athleteId)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (existing.error) dbError(existing.error);
  if (existing.data) throw unprocessable("That coach is already linked to your account.");

  // Insert the roster link under the athlete's own RLS branch.
  const ins = await supabase
    .from("coach_athletes")
    .insert({ athlete_id: athleteId, coach_id: coachId });
  if (ins.error) dbError(ins.error);

  const scopeRows = chosen.map((sport) => ({ athlete_id: athleteId, coach_id: coachId, sport }));
  const scopeIns = await supabase.from("coach_athlete_sports").insert(scopeRows);
  if (scopeIns.error) dbError(scopeIns.error);

  return { ok: true as const, coachId };
}

export type AdultOnboardingStatus = {
  hasAthlete: boolean;
  selfManaged: boolean;
  athleteId: string | null;
};

/** `getAdultOnboardingStatus`: whether the athlete row exists yet. */
export async function getAdultOnboardingStatus(
  ctx: Pick<AdultContext, "userId" | "supabase">,
): Promise<AdultOnboardingStatus> {
  const me = await ctx.supabase
    .from("athletes")
    .select("id, self_managed")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (me.error) dbError(me.error);
  return {
    hasAthlete: !!me.data,
    selfManaged: me.data?.self_managed ?? false,
    athleteId: me.data?.id ?? null,
  };
}

/**
 * Resolve the athlete row owned by the caller's login. RLS
 * (athlete_can_self_connect) is the real gate on every mutator below.
 */
async function requireSelfManagedAthleteId(supabase: Client, userId: string): Promise<string> {
  const me = await supabase.from("athletes").select("id").eq("user_id", userId).maybeSingle();
  if (me.error) dbError(me.error);
  if (!me.data) throw unprocessable("Finish setting up your athlete profile first.");
  return me.data.id;
}

/** The schedule functions also refuse parent-managed rows. */
async function requireStrictlySelfManagedAthleteId(
  supabase: Client,
  userId: string,
): Promise<string> {
  const me = await supabase
    .from("athletes")
    .select("id, self_managed")
    .eq("user_id", userId)
    .maybeSingle();
  if (me.error) dbError(me.error);
  if (!me.data) throw unprocessable("Finish setting up your athlete profile first.");
  if (!me.data.self_managed) throw unprocessable("This account is parent-managed.");
  return me.data.id;
}

export const adultGoalsInput = z.object({
  sport: z.string().min(1).max(64),
  currentLevelKey: z.string().min(1).max(64),
  seasonGoalKey: z.string().min(1).max(64),
  longTermGoal: z.string().max(2000).default(""),
});

/** `saveAdultAthleteGoals`: upsert one sport's goal for the caller. */
export async function saveAdultAthleteGoals(
  ctx: Pick<AdultContext, "userId" | "supabase" | "admin">,
  data: z.infer<typeof adultGoalsInput>,
): Promise<{ ok: true }> {
  const { supabase, admin, userId } = ctx;
  const athleteId = await requireSelfManagedAthleteId(supabase, userId);
  // Read before the upsert so the history row can carry what this replaces.
  const previous = await currentGoalValues(admin, athleteId, data.sport);

  // If a primary coach for this sport exists, stamp coach_id so the row
  // matches the coach-visible RLS branch.
  const primary = await supabase
    .from("athlete_primary_coaches")
    .select("coach_id")
    .eq("athlete_id", athleteId)
    .eq("sport", data.sport)
    .maybeSingle();
  if (primary.error) dbError(primary.error);
  const coachId = primary.data?.coach_id ?? null;

  const up = await supabase.from("athlete_goals").upsert(
    {
      athlete_id: athleteId,
      coach_id: coachId,
      sport: data.sport,
      current_level_key: data.currentLevelKey,
      season_goal_key: data.seasonGoalKey,
      long_term_goal: data.longTermGoal,
    },
    { onConflict: "athlete_id,sport" },
  );
  if (up.error) dbError(up.error);
  await recordGoalsChange(admin, {
    athleteId,
    sport: data.sport,
    role: "athlete",
    userId,
    next: data,
    previous,
  });

  const { ensureStarterPrograms } = await import("./starter-programs.server");
  await ensureStarterPrograms(athleteId, data.sport, data.currentLevelKey);

  return { ok: true as const };
}

export type AdultCoachLink = { coachId: string; coachName: string; sports: string[] };
export type AdultCoachList = {
  hasAthlete: boolean;
  canConnectCoach: boolean;
  needsGuardianEmail: boolean;
  coaches: AdultCoachLink[];
};

/** `listAdultAthleteCoaches`: the caller's linked coaches with per-coach sports. */
export async function listAdultAthleteCoaches(ctx: AdultContext): Promise<AdultCoachList> {
  const { supabase, admin, userId } = ctx;
  const me = await supabase
    .from("athletes")
    .select("id, self_managed, birthdate, guardian_email, parent_id, account_state")
    .eq("user_id", userId)
    .maybeSingle();
  if (me.error) dbError(me.error);
  if (!me.data) {
    return { hasAthlete: false, canConnectCoach: false, needsGuardianEmail: false, coaches: [] };
  }
  // Minors can connect coaches too, but only with a guardian reachable —
  // either an email on file or a linked parent account.
  const needsGuardianEmail = !athleteCanConnectCoach(me.data);
  const athleteId = me.data.id;

  // RLS lets the athlete read their own coach_athletes rows, but not
  // coach_profiles — a !inner join would silently drop every row. Fetch
  // coach ids under RLS, then resolve names via the admin client (the
  // coach_athletes row already authorized the lookup).
  const links = await supabase
    .from("coach_athletes")
    .select("coach_id")
    .eq("athlete_id", athleteId);
  if (links.error) dbError(links.error);
  const coachIds = Array.from(new Set((links.data ?? []).map((l) => l.coach_id)));
  if (coachIds.length === 0) {
    return {
      hasAthlete: true,
      canConnectCoach: !needsGuardianEmail,
      needsGuardianEmail,
      coaches: [],
    };
  }

  const scoped = await supabase
    .from("coach_athlete_sports")
    .select("coach_id, sport")
    .eq("athlete_id", athleteId);
  if (scoped.error) dbError(scoped.error);
  const sportsByCoach = new Map<string, string[]>();
  for (const row of scoped.data ?? []) {
    const arr = sportsByCoach.get(row.coach_id) ?? [];
    arr.push(row.sport);
    sportsByCoach.set(row.coach_id, arr);
  }

  const profiles = await admin
    .from("coach_profiles")
    .select("id, first_name, last_name")
    .in("id", coachIds);
  if (profiles.error) dbError(profiles.error);

  const coaches = (profiles.data ?? []).map((cp) => ({
    coachId: cp.id,
    coachName: `${cp.first_name} ${cp.last_name}`.trim(),
    sports: sportsByCoach.get(cp.id) ?? [],
  }));

  return { hasAthlete: true, canConnectCoach: !needsGuardianEmail, needsGuardianEmail, coaches };
}

/** `unlinkAdultAthleteFromCoach`: drop a coach and their coach-scoped data. */
export async function unlinkAdultAthleteFromCoach(
  ctx: Pick<AdultContext, "userId" | "supabase">,
  coachId: string,
): Promise<{ ok: true }> {
  const { supabase, userId } = ctx;
  const athleteId = await requireSelfManagedAthleteId(supabase, userId);

  await supabase
    .from("athlete_lesson_slots")
    .delete()
    .eq("athlete_id", athleteId)
    .eq("coach_id", coachId);
  await supabase
    .from("athlete_primary_coaches")
    .delete()
    .eq("athlete_id", athleteId)
    .eq("coach_id", coachId);
  await supabase.from("athlete_goals").delete().eq("athlete_id", athleteId).eq("coach_id", coachId);

  const del = await supabase
    .from("coach_athletes")
    .delete()
    .eq("athlete_id", athleteId)
    .eq("coach_id", coachId);
  if (del.error) dbError(del.error);
  return { ok: true as const };
}

export const coachSportsInput = z.object({
  sports: z.array(z.string().min(1).max(64)).min(1, "Pick at least one sport").max(20),
});

/** `updateAdultAthleteCoachSports`: replace the sports one coach works on with the caller. */
export async function updateAdultAthleteCoachSports(
  ctx: AdultContext,
  coachId: string,
  data: z.infer<typeof coachSportsInput>,
): Promise<{ ok: true }> {
  const { supabase, admin, userId } = ctx;
  const athleteId = await requireSelfManagedAthleteId(supabase, userId);

  const link = await supabase
    .from("coach_athletes")
    .select("id")
    .eq("athlete_id", athleteId)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (link.error) dbError(link.error);
  if (!link.data) throw unprocessable("That coach isn't linked to your account.");

  const offeredSet = await offeredSports(admin, coachId);
  const chosen = Array.from(new Set(data.sports));
  for (const s of chosen) {
    if (!offeredSet.has(s)) throw unprocessable(`Coach doesn't offer ${s}.`);
  }

  const existing = await supabase
    .from("coach_athlete_sports")
    .select("sport")
    .eq("athlete_id", athleteId)
    .eq("coach_id", coachId);
  if (existing.error) dbError(existing.error);
  const currentSet = new Set((existing.data ?? []).map((r) => r.sport));
  const chosenSet = new Set(chosen);
  const toAdd = chosen.filter((s) => !currentSet.has(s));
  const toRemove = Array.from(currentSet).filter((s) => !chosenSet.has(s));

  if (toAdd.length > 0) {
    const ins = await supabase
      .from("coach_athlete_sports")
      .insert(toAdd.map((sport) => ({ athlete_id: athleteId, coach_id: coachId, sport })));
    if (ins.error) dbError(ins.error);
  }
  if (toRemove.length > 0) {
    const del = await supabase
      .from("coach_athlete_sports")
      .delete()
      .eq("athlete_id", athleteId)
      .eq("coach_id", coachId)
      .in("sport", toRemove);
    if (del.error) dbError(del.error);

    await supabase
      .from("athlete_primary_coaches")
      .delete()
      .eq("athlete_id", athleteId)
      .eq("coach_id", coachId)
      .in("sport", toRemove);
  }
  return { ok: true as const };
}

/** `getCoachOfferedSportsForAdult`: everything a linked coach offers, so sports can be added, not just removed. */
export async function getCoachOfferedSportsForAdult(
  ctx: AdultContext,
  coachId: string,
): Promise<{ sports: string[] }> {
  const { supabase, admin, userId } = ctx;
  const athleteId = await requireSelfManagedAthleteId(supabase, userId);

  const link = await supabase
    .from("coach_athletes")
    .select("id")
    .eq("athlete_id", athleteId)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (link.error) dbError(link.error);
  if (!link.data) throw unprocessable("That coach isn't linked to your account.");

  return { sports: Array.from(await offeredSports(admin, coachId)) };
}

export type ScheduleSlotDTO = z.infer<typeof lessonSlotSchema>;
export type CoachScheduleDTO = { coachId: string; coachName: string; slots: ScheduleSlotDTO[] };

/** `getAdultAthleteSchedules`: lesson slots per linked coach. */
export async function getAdultAthleteSchedules(
  ctx: AdultContext,
): Promise<{ coaches: CoachScheduleDTO[] }> {
  const { supabase, admin, userId } = ctx;
  const athleteId = await requireStrictlySelfManagedAthleteId(supabase, userId);

  const links = await supabase
    .from("coach_athletes")
    .select("coach_id")
    .eq("athlete_id", athleteId);
  if (links.error) dbError(links.error);
  const coachIds = Array.from(new Set((links.data ?? []).map((l) => l.coach_id)));
  if (coachIds.length === 0) return { coaches: [] };

  const [profiles, slots] = await Promise.all([
    admin.from("coach_profiles").select("id, first_name, last_name").in("id", coachIds),
    admin
      .from("athlete_lesson_slots")
      .select(
        "coach_id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on",
      )
      .eq("athlete_id", athleteId)
      .in("coach_id", coachIds),
  ]);
  if (profiles.error) dbError(profiles.error);
  if (slots.error) dbError(slots.error);

  const slotsByCoach = new Map<string, ScheduleSlotDTO[]>();
  for (const s of slots.data ?? []) {
    if (!s.coach_id) continue;
    const arr = slotsByCoach.get(s.coach_id) ?? [];
    arr.push({
      dayOfWeek: s.day_of_week,
      startMinute: s.start_minute,
      endMinute: s.end_minute,
      frequency: (s.frequency ?? "weekly") as ScheduleSlotDTO["frequency"],
      weeksOfMonth: (s.weeks_of_month ?? []) as number[],
      startsOn: (s.starts_on as string | null) ?? null,
    });
    slotsByCoach.set(s.coach_id, arr);
  }

  return {
    coaches: (profiles.data ?? []).map((cp) => ({
      coachId: cp.id,
      coachName: `${cp.first_name} ${cp.last_name}`.trim(),
      slots: slotsByCoach.get(cp.id) ?? [],
    })),
  };
}

export const adultScheduleInput = z.object({ slots: z.array(lessonSlotSchema).max(20) });

/** `saveAdultAthleteScheduleForCoach`: replace the caller's slots with one linked coach. */
export async function saveAdultAthleteScheduleForCoach(
  ctx: AdultContext,
  coachId: string,
  data: z.infer<typeof adultScheduleInput>,
): Promise<{ ok: true }> {
  const { supabase, admin, userId } = ctx;
  const athleteId = await requireStrictlySelfManagedAthleteId(supabase, userId);

  for (const s of data.slots) {
    if (s.endMinute <= s.startMinute) throw unprocessable("End time must be after start time.");
  }

  // Verify caller is linked to this coach before writing.
  const link = await supabase
    .from("coach_athletes")
    .select("coach_id")
    .eq("athlete_id", athleteId)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (link.error) dbError(link.error);
  if (!link.data) throw unprocessable("You aren't linked to this coach.");

  const del = await admin
    .from("athlete_lesson_slots")
    .delete()
    .eq("athlete_id", athleteId)
    .eq("coach_id", coachId);
  if (del.error) dbError(del.error);

  if (data.slots.length > 0) {
    const ins = await admin.from("athlete_lesson_slots").insert(
      data.slots.map((s) => ({
        athlete_id: athleteId,
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
