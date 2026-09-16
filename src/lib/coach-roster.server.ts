/**
 * The coach's roster and week schedule — roster read, practice summaries,
 * adding and removing athletes, recurring lesson slots and their per-date
 * overrides — the single source of truth for the web server functions
 * (coach-roster.functions.ts, coach-schedule.functions.ts,
 * coach-roster-mutations.functions.ts) and the `/api/v1/coach/roster*` and
 * `/api/v1/coach/lesson-slots*` routes (PRD §7.2, Appendix A "Coach roster
 * and schedule"). Extracted without behavior changes; user-facing messages
 * are kept verbatim and carried on ApiError so the API gets stable codes.
 *
 * One additive change: roster slots now carry `frequency`, `weeksOfMonth`,
 * and `startsOn`, so a client can expand occurrences with
 * `lesson-recurrence.ts` rules (PRD §7.2 "Lesson slots"). The web week view
 * keeps treating every slot as weekly, as before.
 */
import { z } from "zod";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ApiError } from "./api/errors";
import { athleteLimitForTier, computeEffectiveTier } from "./coach-profile-types";
import { getSportLevel } from "./coach-sports";
import { dbError } from "./db-error";
import type { LessonFrequency } from "./lesson-recurrence";

type Admin = typeof supabaseAdmin;

export type RosterContext = { userId: string; admin: Admin };

const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });
const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });

export type SlotOverride = {
  date: string; // YYYY-MM-DD
  status: "canceled" | "rescheduled";
  startMinute: number | null;
  endMinute: number | null;
};

export type RosterSlot = {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  frequency: LessonFrequency;
  weeksOfMonth: number[];
  startsOn: string | null;
  overrides: SlotOverride[];
};

export type RosterAthlete = {
  athleteId: string;
  firstName: string;
  lastName: string;
  sport: string | null;
  // Null for self-managed adult athletes (no parent in the loop).
  parentFirstName: string | null;
  parentLastName: string | null;
  selfManaged: boolean;
  slots: RosterSlot[];
  // Count of OTHER coaches on this athlete's roster (excluding the viewer).
  otherCoachCount: number;
  // When N=1, the single other coach's last name for the "+ D. Wallace" chip.
  otherCoachLastName: string | null;
};

export type CoachRoster = {
  coachSports: string[];
  athletes: RosterAthlete[];
};

async function coachIdOrNull(admin: Admin, userId: string): Promise<string | null> {
  const coach = await admin.from("coach_profiles").select("id").eq("user_id", userId).maybeSingle();
  if (coach.error) dbError(coach.error);
  return coach.data?.id ?? null;
}

async function requireCoachId(admin: Admin, userId: string): Promise<string> {
  const id = await coachIdOrNull(admin, userId);
  if (!id) throw unprocessable("Coach profile not found");
  return id;
}

/** `getCoachRoster`: every rostered athlete with their slots and overrides, plus the coach's sports. */
export async function getCoachRoster(ctx: RosterContext): Promise<CoachRoster> {
  const { admin, userId } = ctx;
  const coachId = await coachIdOrNull(admin, userId);
  if (!coachId) return { coachSports: [], athletes: [] };

  const levelsRes = await admin.from("coach_levels").select("sport").eq("coach_id", coachId);
  if (levelsRes.error) dbError(levelsRes.error);
  const coachSports = Array.from(
    new Set((levelsRes.data ?? []).map((r) => r.sport as string)),
  ).sort();

  const links = await admin
    .from("coach_athletes")
    .select(
      "athlete_id, athletes!inner(id, first_name, last_name, self_managed, parent_profiles(first_name, last_name))",
    )
    .eq("coach_id", coachId);
  if (links.error) dbError(links.error);

  const rows = links.data ?? [];
  if (rows.length === 0) return { coachSports, athletes: [] };

  const athleteIds = rows.map((r) => r.athlete_id as string);

  const [sportsRes, slotsRes, otherLinksRes] = await Promise.all([
    admin
      .from("coach_athlete_sports")
      .select("athlete_id, sport")
      .eq("coach_id", coachId)
      .in("athlete_id", athleteIds),
    admin
      .from("athlete_lesson_slots")
      .select(
        "id, athlete_id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on",
      )
      .eq("coach_id", coachId)
      .in("athlete_id", athleteIds),
    admin
      .from("coach_athletes")
      .select("athlete_id, coach_profiles!inner(last_name)")
      .in("athlete_id", athleteIds)
      .neq("coach_id", coachId),
  ]);
  if (sportsRes.error) dbError(sportsRes.error);
  if (slotsRes.error) dbError(slotsRes.error);
  if (otherLinksRes.error) dbError(otherLinksRes.error);

  const slotIds = (slotsRes.data ?? []).map((s) => s.id as string);
  const overridesRes = slotIds.length
    ? await admin
        .from("lesson_slot_overrides")
        .select("slot_id, occurrence_date, status, start_minute, end_minute")
        .in("slot_id", slotIds)
    : {
        data: [] as Array<{
          slot_id: string;
          occurrence_date: string;
          status: string;
          start_minute: number | null;
          end_minute: number | null;
        }>,
        error: null,
      };
  if (overridesRes.error) dbError(overridesRes.error);

  const overridesBySlot = new Map<string, SlotOverride[]>();
  for (const o of overridesRes.data ?? []) {
    const arr = overridesBySlot.get(o.slot_id) ?? [];
    arr.push({
      date: o.occurrence_date,
      status: o.status as "canceled" | "rescheduled",
      startMinute: o.start_minute,
      endMinute: o.end_minute,
    });
    overridesBySlot.set(o.slot_id, arr);
  }

  const sportByAthlete = new Map<string, string>();
  for (const r of sportsRes.data ?? []) {
    if (!sportByAthlete.has(r.athlete_id)) sportByAthlete.set(r.athlete_id, r.sport);
  }

  const slotsByAthlete = new Map<string, RosterSlot[]>();
  for (const s of slotsRes.data ?? []) {
    const arr = slotsByAthlete.get(s.athlete_id) ?? [];
    arr.push({
      id: s.id,
      dayOfWeek: s.day_of_week,
      startMinute: s.start_minute,
      endMinute: s.end_minute,
      frequency: ((s.frequency as string | null) ?? "weekly") as LessonFrequency,
      weeksOfMonth: ((s.weeks_of_month as number[] | null) ?? []).map(Number),
      startsOn: (s.starts_on as string | null) ?? null,
      overrides: overridesBySlot.get(s.id) ?? [],
    });
    slotsByAthlete.set(s.athlete_id, arr);
  }

  // Sort slots Mon→Sun (treat Sunday=0 as last)
  const dayOrder = (d: number) => (d === 0 ? 7 : d);
  for (const arr of slotsByAthlete.values()) {
    arr.sort(
      (a, b) => dayOrder(a.dayOfWeek) - dayOrder(b.dayOfWeek) || a.startMinute - b.startMinute,
    );
  }

  // Group other-coach links per athlete.
  type OtherLinkRow = { athlete_id: string; coach_profiles: { last_name: string } };
  const otherByAthlete = new Map<string, string[]>();
  for (const l of (otherLinksRes.data ?? []) as unknown as OtherLinkRow[]) {
    const arr = otherByAthlete.get(l.athlete_id) ?? [];
    arr.push(l.coach_profiles.last_name);
    otherByAthlete.set(l.athlete_id, arr);
  }

  const result: RosterAthlete[] = rows.map((r) => {
    const a = r.athletes as unknown as {
      id: string;
      first_name: string;
      last_name: string;
      self_managed: boolean | null;
      parent_profiles: { first_name: string; last_name: string } | null;
    };
    const others = otherByAthlete.get(a.id) ?? [];
    return {
      athleteId: a.id,
      firstName: a.first_name,
      lastName: a.last_name,
      sport: sportByAthlete.get(a.id) ?? null,
      parentFirstName: a.parent_profiles?.first_name ?? null,
      parentLastName: a.parent_profiles?.last_name ?? null,
      selfManaged: a.self_managed === true,
      slots: slotsByAthlete.get(a.id) ?? [],
      otherCoachCount: others.length,
      otherCoachLastName: others.length === 1 ? others[0] : null,
    };
  });

  result.sort(
    (a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName),
  );

  return { coachSports, athletes: result };
}

// --- Practice summaries ---------------------------------------------------

export type AthletePracticeSummary = {
  athleteId: string;
  hoursLogged: number;
  expectedHoursPerWeek: number | null;
  seasonGoalLabel: string | null;
  /** state_index per session, newest first, capped to recent 20. 0=frustrated..4=flowing */
  sessionStates: number[];
  sessionCount: number;
  windowDays: number;
};

const SUMMARY_WINDOW_DAYS = 7;

/** `getRosterPracticeSummaries`: the last 7 days of logged practice per rostered athlete. */
export async function getRosterPracticeSummaries(
  ctx: RosterContext,
  now: Date = new Date(),
): Promise<AthletePracticeSummary[]> {
  const { admin, userId } = ctx;
  const coachId = await coachIdOrNull(admin, userId);
  if (!coachId) return [];

  const links = await admin.from("coach_athletes").select("athlete_id").eq("coach_id", coachId);
  if (links.error) dbError(links.error);
  const athleteIds = (links.data ?? []).map((r) => r.athlete_id as string);
  if (athleteIds.length === 0) return [];

  const [scopeRes, goalsRes, levelsRes] = await Promise.all([
    admin
      .from("coach_athlete_sports")
      .select("athlete_id, sport")
      .eq("coach_id", coachId)
      .in("athlete_id", athleteIds),
    admin
      .from("athlete_goals")
      .select("athlete_id, sport, season_goal_key")
      .in("athlete_id", athleteIds),
    admin
      .from("coach_levels")
      .select("sport, level_key, practice_hours_per_week")
      .eq("coach_id", coachId),
  ]);
  if (scopeRes.error) dbError(scopeRes.error);
  if (goalsRes.error) dbError(goalsRes.error);
  if (levelsRes.error) dbError(levelsRes.error);

  // Restrict goals to the (athlete, sport) pairs this coach actually
  // coaches — goals are parent-owned per athlete+sport, not per coach.
  const allowedPairs = new Set<string>();
  for (const s of scopeRes.data ?? []) {
    allowedPairs.add(`${s.athlete_id}::${s.sport}`);
  }
  const filteredGoals = (goalsRes.data ?? []).filter((g) =>
    allowedPairs.has(`${g.athlete_id}::${g.sport}`),
  );

  const expectedByKey = new Map<string, number>();
  for (const l of levelsRes.data ?? []) {
    expectedByKey.set(`${l.sport}::${l.level_key}`, Number(l.practice_hours_per_week));
  }

  const since = new Date(now.getTime() - SUMMARY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Count ALL practice the athlete has logged in the window, regardless of
  // which plan or coach. The denominator stays scoped to this coach's level
  // settings via expectedByKey above.
  const sRes = await admin
    .from("plan_sessions")
    .select("athlete_id, duration_seconds, state_index, logged_at")
    .in("athlete_id", athleteIds)
    .gte("logged_at", since)
    .order("logged_at", { ascending: false });
  if (sRes.error) dbError(sRes.error);
  const sessions = (sRes.data ?? []) as Array<{
    athlete_id: string;
    duration_seconds: number;
    state_index: number;
    logged_at: string;
  }>;

  const sessionsByAthlete = new Map<string, { secs: number; states: number[] }>();
  for (const s of sessions) {
    const cur = sessionsByAthlete.get(s.athlete_id) ?? { secs: 0, states: [] };
    cur.secs += s.duration_seconds;
    cur.states.push(s.state_index);
    sessionsByAthlete.set(s.athlete_id, cur);
  }

  return athleteIds.map((athleteId) => {
    const agg = sessionsByAthlete.get(athleteId);
    const goal = filteredGoals.find((g) => g.athlete_id === athleteId);
    const expected = goal
      ? (expectedByKey.get(`${goal.sport}::${goal.season_goal_key}`) ?? null)
      : null;
    const seasonGoalLabel = goal
      ? (getSportLevel(goal.sport, goal.season_goal_key)?.label ?? null)
      : null;
    return {
      athleteId,
      hoursLogged: agg ? agg.secs / 3600 : 0,
      expectedHoursPerWeek: expected,
      seasonGoalLabel,
      sessionStates: agg ? agg.states.slice(0, 20) : [],
      sessionCount: agg ? agg.states.length : 0,
      windowDays: SUMMARY_WINDOW_DAYS,
    };
  });
}

// --- Roster mutations -----------------------------------------------------

export const addAthleteInput = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  birthdate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid birthdate")
    .optional(),
  guardianEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid parent or guardian email")
    .max(255)
    .optional(),
  sport: z.string().trim().min(1).max(40).optional(),
  emailRecipient: z.enum(["guardian", "athlete"]).default("guardian"),
});

export type AddAthleteResult = { athleteId: string; guardianEmail: string | null };

/**
 * `addAthleteWithGuardian`: a youth athlete on the roster before the parent
 * signs up. The guardian email is required for minors: the parent gets a
 * claim link at once and copies of coach messages until they join.
 */
export async function addAthleteWithGuardian(
  ctx: RosterContext,
  data: z.infer<typeof addAthleteInput>,
  now: Date = new Date(),
): Promise<AddAthleteResult> {
  const { admin, userId } = ctx;
  const coachId = await requireCoachId(admin, userId);
  const { newGuardianToken, sendGuardianInvite } = await import("./guardian.server");

  // Plan cap: the DB trigger (enforce_coach_roster_cap) is the backstop, but
  // we stop short of it so the coach gets a friendly "Roster full" message
  // instead of a raw database error. Mirrors the same pre-check in
  // commitScheduleImport (schedule-import.server.ts).
  const coachRow = await admin
    .from("coach_profiles")
    .select("organization_id, subscription_tier")
    .eq("id", coachId)
    .single();
  if (coachRow.error) dbError(coachRow.error);
  const tier = computeEffectiveTier({
    organizationId: coachRow.data.organization_id ?? null,
    subscriptionTier: (coachRow.data.subscription_tier as "coach" | "coach_pro" | null) ?? null,
  });
  const athleteLimit = athleteLimitForTier(tier);
  if (athleteLimit !== null) {
    const roster = await admin.from("coach_athletes").select("athlete_id").eq("coach_id", coachId);
    if (roster.error) dbError(roster.error);
    if ((roster.data ?? []).length >= athleteLimit) {
      throw new Error(
        `Roster full: the ${tier} plan is limited to ${athleteLimit} athletes. Upgrade to add more.`,
      );
    }
  }

  if (data.birthdate) {
    const [y, m, d] = data.birthdate.split("-").map(Number);
    const dob = new Date(Date.UTC(y, m - 1, d));
    if (Number.isNaN(dob.getTime()) || dob > now) throw unprocessable("Enter a valid birthdate");
    const ageMs = now.getTime() - dob.getTime();
    const age = Math.floor(ageMs / (365.25 * 24 * 3600 * 1000));
    if (age > 120) throw unprocessable("Enter a valid birthdate");
    if (age < 18 && !data.guardianEmail) {
      throw unprocessable("Athletes under 18 need a parent or guardian email.");
    }
  }

  const guardianEmail = data.guardianEmail ?? null;
  const token = guardianEmail ? newGuardianToken() : null;

  const athleteIns = await admin
    .from("athletes")
    .insert({
      first_name: data.firstName,
      last_name: data.lastName,
      birthdate: data.birthdate ?? null,
      parent_id: null,
      self_managed: false,
      motivation: "",
      guardian_email: guardianEmail,
      guardian_claim_token: token,
      guardian_invited_at: guardianEmail ? now.toISOString() : null,
      added_by_coach_id: coachId,
      invite_recipient: data.emailRecipient,
    })
    .select("id")
    .single();
  if (athleteIns.error) dbError(athleteIns.error);
  const athleteId = athleteIns.data.id;

  const link = await admin
    .from("coach_athletes")
    .insert({ coach_id: coachId, athlete_id: athleteId, coach_ack_at: now.toISOString() });
  if (link.error) {
    // Roster cap trigger (or any other failure) — roll the athlete back so we
    // don't strand an orphan row the coach can't see.
    await admin.from("athletes").delete().eq("id", athleteId);
    dbError(link.error);
  }

  if (data.sport) {
    const sportIns = await admin
      .from("coach_athlete_sports")
      .insert({ coach_id: coachId, athlete_id: athleteId, sport: data.sport });
    if (sportIns.error) console.error("[roster] sport link failed", sportIns.error);
  }

  if (guardianEmail && token) {
    const coach = await admin
      .from("coach_profiles")
      .select("first_name, last_name")
      .eq("id", coachId)
      .maybeSingle();
    await sendGuardianInvite({
      to: guardianEmail,
      athleteName: `${data.firstName} ${data.lastName}`.trim(),
      coachName: coach.data ? `${coach.data.first_name} ${coach.data.last_name}`.trim() : undefined,
      token,
      recipient: data.emailRecipient,
    });
  }

  return { athleteId, guardianEmail };
}

/** `removeAthleteFromRoster`: unlink; the athlete's slots with this coach are kept but unassigned. */
export async function removeAthleteFromRoster(
  ctx: RosterContext,
  athleteId: string,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  const coachId = await requireCoachId(admin, userId);

  // Null out coach_id on any slots this coach owns for the athlete so the
  // recurring schedule survives a future re-link.
  const slotsRes = await admin
    .from("athlete_lesson_slots")
    .update({ coach_id: null })
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId);
  if (slotsRes.error) dbError(slotsRes.error);

  const primaryRes = await admin
    .from("athlete_primary_coaches")
    .delete()
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId);
  if (primaryRes.error) dbError(primaryRes.error);

  const linkRes = await admin
    .from("coach_athletes")
    .delete()
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId);
  if (linkRes.error) dbError(linkRes.error);

  return { ok: true as const };
}

// --- Lesson slots ---------------------------------------------------------

const dayOfWeekSchema = z.number().int().min(0).max(6);
const minuteSchema = z.number().int().min(0).max(1440);
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

/** Start before end, both inside the day (the web's `validateTimeRange`). */
const timeRange = z
  .object({ startMinute: minuteSchema, endMinute: minuteSchema })
  .refine((v) => v.startMinute < v.endMinute, { message: "Invalid time range" });

const frequencySchema = z.enum(["weekly", "biweekly", "twice_monthly", "monthly"]).default("weekly");
const weeksOfMonthSchema = z.array(z.number().int().min(1).max(5)).default([]);
const startsOnSchema = isoDateSchema.nullable().default(null);

/** Same cardinality/anchor rules as the web's `schedule-editor.tsx` `validateSlots()`, enforced server-side here for the first time. */
function refineCadence<T extends { frequency: string; weeksOfMonth: number[]; startsOn: string | null }>(
  v: T,
  ctx: z.RefinementCtx,
) {
  if (v.frequency === "twice_monthly" && v.weeksOfMonth.length !== 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Pick exactly 2 weeks of the month", path: ["weeksOfMonth"] });
  }
  if (v.frequency === "monthly" && v.weeksOfMonth.length !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Pick exactly 1 week of the month", path: ["weeksOfMonth"] });
  }
  if (v.frequency === "biweekly" && !v.startsOn) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Pick a starting date for a biweekly lesson", path: ["startsOn"] });
  }
}

export const slotTimesInput = z
  .object({
    dayOfWeek: dayOfWeekSchema,
    startMinute: minuteSchema,
    endMinute: minuteSchema,
    frequency: frequencySchema,
    weeksOfMonth: weeksOfMonthSchema,
    startsOn: startsOnSchema,
  })
  .refine((v) => v.startMinute < v.endMinute, {
    message: "Invalid time range",
    path: ["endMinute"],
  })
  .superRefine(refineCadence);

export const addLessonSlotInput = z
  .object({
    athleteId: z.string().uuid(),
    dayOfWeek: dayOfWeekSchema,
    startMinute: minuteSchema,
    endMinute: minuteSchema,
    frequency: frequencySchema,
    weeksOfMonth: weeksOfMonthSchema,
    startsOn: startsOnSchema,
  })
  .refine((v) => v.startMinute < v.endMinute, {
    message: "Invalid time range",
    path: ["endMinute"],
  })
  .superRefine(refineCadence);

export const occurrenceTimesInput = timeRange;

async function assertOwnsSlot(admin: Admin, coachId: string, slotId: string) {
  const res = await admin
    .from("athlete_lesson_slots")
    .select("athlete_id, coach_id, day_of_week, start_minute, end_minute")
    .eq("id", slotId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  if (!res.data || res.data.coach_id !== coachId) throw notFound("Lesson not found");
  return {
    athleteId: res.data.athlete_id as string,
    dayOfWeek: res.data.day_of_week as number,
    startMinute: res.data.start_minute as number,
    endMinute: res.data.end_minute as number,
  };
}

async function assertRosters(admin: Admin, coachId: string, athleteId: string) {
  const res = await admin
    .from("coach_athletes")
    .select("id")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  if (!res.data) throw unprocessable("Athlete is not on your roster");
}

/** `addLessonSlot`: a new weekly lesson for a rostered athlete. */
export async function addLessonSlot(
  ctx: RosterContext,
  data: z.infer<typeof addLessonSlotInput>,
): Promise<{ id: string }> {
  const { admin, userId } = ctx;
  const coachId = await requireCoachId(admin, userId);
  await assertRosters(admin, coachId, data.athleteId);
  const res = await admin
    .from("athlete_lesson_slots")
    .insert({
      athlete_id: data.athleteId,
      coach_id: coachId,
      day_of_week: data.dayOfWeek,
      start_minute: data.startMinute,
      end_minute: data.endMinute,
      frequency: data.frequency,
      weeks_of_month: data.frequency === "biweekly" || data.frequency === "weekly" ? [] : data.weeksOfMonth,
      starts_on: data.frequency === "biweekly" ? data.startsOn : null,
    })
    .select("id")
    .single();
  if (res.error) dbError(res.error);
  return { id: res.data!.id };
}

/** `updateLessonSlot`: move a recurring lesson's day, times, and cadence. */
export async function updateLessonSlot(
  ctx: RosterContext,
  slotId: string,
  data: z.infer<typeof slotTimesInput>,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  const coachId = await requireCoachId(admin, userId);
  await assertOwnsSlot(admin, coachId, slotId);
  const res = await admin
    .from("athlete_lesson_slots")
    .update({
      day_of_week: data.dayOfWeek,
      start_minute: data.startMinute,
      end_minute: data.endMinute,
      frequency: data.frequency,
      weeks_of_month: data.frequency === "biweekly" || data.frequency === "weekly" ? [] : data.weeksOfMonth,
      starts_on: data.frequency === "biweekly" ? data.startsOn : null,
    })
    .eq("id", slotId);
  if (res.error) dbError(res.error);
  return { ok: true as const };
}

/** `deleteLessonSlot`: remove a recurring lesson (its overrides go with it). */
export async function deleteLessonSlot(ctx: RosterContext, slotId: string): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  const coachId = await requireCoachId(admin, userId);
  await assertOwnsSlot(admin, coachId, slotId);
  const res = await admin.from("athlete_lesson_slots").delete().eq("id", slotId);
  if (res.error) dbError(res.error);
  return { ok: true as const };
}

/** `cancelLessonOccurrence`: skip one date. */
export async function cancelLessonOccurrence(
  ctx: RosterContext,
  slotId: string,
  date: string,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  const coachId = await requireCoachId(admin, userId);
  await assertOwnsSlot(admin, coachId, slotId);
  const res = await admin.from("lesson_slot_overrides").upsert(
    {
      slot_id: slotId,
      occurrence_date: date,
      status: "canceled",
      start_minute: null,
      end_minute: null,
    },
    { onConflict: "slot_id,occurrence_date" },
  );
  if (res.error) dbError(res.error);
  return { ok: true as const };
}

/** `rescheduleLessonOccurrence`: new times for one date. */
export async function rescheduleLessonOccurrence(
  ctx: RosterContext,
  slotId: string,
  date: string,
  data: z.infer<typeof occurrenceTimesInput>,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  const coachId = await requireCoachId(admin, userId);
  await assertOwnsSlot(admin, coachId, slotId);
  const res = await admin.from("lesson_slot_overrides").upsert(
    {
      slot_id: slotId,
      occurrence_date: date,
      status: "rescheduled",
      start_minute: data.startMinute,
      end_minute: data.endMinute,
    },
    { onConflict: "slot_id,occurrence_date" },
  );
  if (res.error) dbError(res.error);
  return { ok: true as const };
}

/** `clearLessonOverride`: put one date back on the regular schedule. */
export async function clearLessonOverride(
  ctx: RosterContext,
  slotId: string,
  date: string,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  const coachId = await requireCoachId(admin, userId);
  await assertOwnsSlot(admin, coachId, slotId);
  const res = await admin
    .from("lesson_slot_overrides")
    .delete()
    .eq("slot_id", slotId)
    .eq("occurrence_date", date);
  if (res.error) dbError(res.error);
  return { ok: true as const };
}
