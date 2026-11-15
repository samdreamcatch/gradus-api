/**
 * Group lessons (PRD decision #68, §6.16; milestone GL1): two to eight
 * athletes in one lesson. A group is a link between ordinary per-athlete
 * slots (`athlete_lesson_slots.group_id`), so invoices, wrap-ups, rooms and
 * every existing slot read stay one per athlete.
 *
 * Backs the `/api/v1/coach/lesson-groups` routes. There is no web UI: the
 * web keeps listing each athlete's lesson separately.
 *
 * The service-role client has no multi-statement transactions, so each
 * function is ordered so that every statement on its own leaves a valid
 * state: members are inserted or removed with one statement each, the shared
 * schedule moves with one UPDATE across the group, and a group left with one
 * member is read as a private lesson (`getCoachRoster`) until its link is
 * cleared here.
 */
import { z } from "zod";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { slotsCoincide } from "./lesson-group-guard.server";
import {
  dayOfWeekSchema,
  dissolveGroupIfSingle,
  frequencySchema,
  groupLessonsNotReady,
  isMissingColumn,
  minuteSchema,
  refineCadence,
  requireCoachId,
  startsOnSchema,
  weeksOfMonthSchema,
  type RosterContext,
} from "./coach-roster.server";

type Admin = typeof supabaseAdmin;

export const GROUP_MIN_ATHLETES = 2;
export const GROUP_MAX_ATHLETES = 8;

const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });
const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });

const priceCentsSchema = z.number().int().min(0).max(10_000_000);
const athleteIdsSchema = z
  .array(z.string().uuid())
  .refine((ids) => new Set(ids).size === ids.length, { message: "An athlete is listed twice" });

const scheduleShape = {
  dayOfWeek: dayOfWeekSchema,
  startMinute: minuteSchema,
  endMinute: minuteSchema,
  frequency: frequencySchema,
  weeksOfMonth: weeksOfMonthSchema,
  startsOn: startsOnSchema,
};

/** `POST /api/v1/coach/lesson-groups` body. */
export const createLessonGroupInput = z
  .object({
    athleteIds: athleteIdsSchema.pipe(
      z
        .array(z.string())
        .min(GROUP_MIN_ATHLETES, "A group lesson needs at least 2 athletes")
        .max(GROUP_MAX_ATHLETES, "A group lesson holds at most 8 athletes"),
    ),
    ...scheduleShape,
    /** Each athlete's price for this lesson; null or absent bills their usual rate. */
    priceCents: priceCentsSchema.nullable().default(null),
  })
  .refine((v) => v.startMinute < v.endMinute, {
    message: "Invalid time range",
    path: ["endMinute"],
  })
  .superRefine(refineCadence);

/** `PATCH /api/v1/coach/lesson-groups/{id}` body: every part optional. */
export const updateLessonGroupInput = z.object({
  /** The whole schedule, when it changes; it moves for every member. */
  schedule: z
    .object(scheduleShape)
    .refine((v) => v.startMinute < v.endMinute, {
      message: "Invalid time range",
      path: ["endMinute"],
    })
    .superRefine(refineCadence)
    .optional(),
  /** Absent leaves prices alone; null returns every member to their usual rate. */
  priceCents: priceCentsSchema.nullable().optional(),
  addAthleteIds: athleteIdsSchema.default([]),
  removeAthleteIds: athleteIdsSchema.default([]),
});

/** `PUT /api/v1/coach/lesson-groups/{id}/occurrences/{date}` body. */
export const setGroupOccurrenceInput = z.object({
  /** New times for this date only, for everyone who is coming. */
  reschedule: z
    .object({ startMinute: minuteSchema, endMinute: minuteSchema })
    .refine((v) => v.startMinute < v.endMinute, { message: "Invalid time range" })
    .nullable()
    .default(null),
  /** Who is not coming on this date; anyone not listed is coming. */
  out: z
    .array(z.object({ athleteId: z.string().uuid(), billable: z.boolean().default(false) }))
    .max(GROUP_MAX_ATHLETES)
    .default([])
    .refine((rows) => new Set(rows.map((r) => r.athleteId)).size === rows.length, {
      message: "An athlete is listed twice",
    }),
});

type MemberRow = {
  id: string;
  athlete_id: string;
  day_of_week: number;
  start_minute: number;
  end_minute: number;
  frequency: string | null;
  weeks_of_month: number[] | null;
  starts_on: string | null;
  price_cents: number | null;
};

type Rows<T> = { data: T[] | null; error: { code?: string; message: string } | null };

const MEMBER_COLUMNS =
  "id, athlete_id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on, price_cents";

/** The group's member slots, owned by this coach; 404 when there are none. */
async function loadGroup(admin: Admin, coachId: string, groupId: string): Promise<MemberRow[]> {
  const res = (await admin
    .from("athlete_lesson_slots")
    .select(MEMBER_COLUMNS)
    .eq("coach_id", coachId)
    .eq("group_id" as never, groupId)) as unknown as Rows<MemberRow>;
  if (isMissingColumn(res.error)) throw groupLessonsNotReady();
  if (res.error) dbError(res.error);
  const members = res.data ?? [];
  if (members.length === 0) throw notFound("Group lesson not found");
  return members;
}

/** Every id must be on the coach's roster; one query for all of them. */
async function assertAllRostered(admin: Admin, coachId: string, athleteIds: string[]) {
  if (athleteIds.length === 0) return;
  const res = await admin
    .from("coach_athletes")
    .select("athlete_id")
    .eq("coach_id", coachId)
    .in("athlete_id", athleteIds);
  if (res.error) dbError(res.error);
  const found = new Set((res.data ?? []).map((r) => r.athlete_id as string));
  if (athleteIds.some((id) => !found.has(id))) {
    throw unprocessable("Every athlete in a group lesson must be on your roster");
  }
}

/**
 * An athlete joining a group must not already have a lesson with this coach
 * at an overlapping time on that day: two slots would mean two reminders, two
 * wrap-ups and two invoice lines for one lesson. The coach removes the
 * private lesson first.
 */
async function assertNoClash(
  admin: Admin,
  coachId: string,
  athleteIds: string[],
  at: Parameters<typeof slotsCoincide>[0],
  ownGroupId: string | null,
) {
  if (athleteIds.length === 0) return;
  const res = (await admin
    .from("athlete_lesson_slots")
    .select(
      "athlete_id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on, group_id",
    )
    .eq("coach_id", coachId)
    .eq("day_of_week", at.day_of_week)
    .in("athlete_id", athleteIds)) as unknown as Rows<
    Parameters<typeof slotsCoincide>[0] & { athlete_id: string; group_id: string | null }
  >;
  if (isMissingColumn(res.error)) throw groupLessonsNotReady();
  if (res.error) dbError(res.error);
  const clash = (res.data ?? []).some(
    (r) => !(ownGroupId != null && r.group_id === ownGroupId) && slotsCoincide(r, at),
  );
  if (clash) {
    throw unprocessable(
      "An athlete already has a lesson with you at that time. Remove that lesson first.",
    );
  }
}

function scheduleColumns(s: z.infer<typeof createLessonGroupInput> | ScheduleInput) {
  const cadenceFree = s.frequency === "biweekly" || s.frequency === "weekly";
  return {
    day_of_week: s.dayOfWeek,
    start_minute: s.startMinute,
    end_minute: s.endMinute,
    frequency: s.frequency,
    weeks_of_month: cadenceFree ? [] : s.weeksOfMonth,
    starts_on: s.frequency === "biweekly" ? s.startsOn : null,
  };
}

type ScheduleInput = NonNullable<z.infer<typeof updateLessonGroupInput>["schedule"]>;

/** A write that named a column the database doesn't have yet → 503, anything else → the usual mapping. */
function failWrite(error: { code?: string; message: string }): never {
  if (isMissingColumn(error)) throw groupLessonsNotReady();
  // The size trigger (`athlete_lesson_slots_group_guard`) raises 23514.
  if (error.code === "23514") throw unprocessable("A group lesson holds at most 8 athletes");
  dbError(error);
}

/** `createLessonGroup`: one recurring lesson for two to eight rostered athletes. */
export async function createLessonGroup(
  ctx: RosterContext,
  data: z.infer<typeof createLessonGroupInput>,
): Promise<{ id: string; slotIds: string[] }> {
  const { admin, userId } = ctx;
  const coachId = await requireCoachId(admin, userId);
  await assertAllRostered(admin, coachId, data.athleteIds);
  await assertNoClash(admin, coachId, data.athleteIds, scheduleColumns(data), null);

  const groupId = crypto.randomUUID();
  const schedule = scheduleColumns(data);
  // One INSERT for every member: all of them land, or none.
  const res = (await admin
    .from("athlete_lesson_slots")
    .insert(
      data.athleteIds.map((athleteId) => ({
        athlete_id: athleteId,
        coach_id: coachId,
        ...schedule,
        group_id: groupId,
        price_cents: data.priceCents,
      })) as never,
    )
    .select("id")) as unknown as Rows<{ id: string }>;
  if (res.error) failWrite(res.error);
  return { id: groupId, slotIds: (res.data ?? []).map((r) => r.id) };
}

/**
 * `updateLessonGroup`: move the group's schedule, set its price, add or
 * remove athletes. Removing down to one athlete leaves a private lesson;
 * removing everyone is refused (delete the group instead).
 */
export async function updateLessonGroup(
  ctx: RosterContext,
  groupId: string,
  data: z.infer<typeof updateLessonGroupInput>,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  const coachId = await requireCoachId(admin, userId);
  const members = await loadGroup(admin, coachId, groupId);
  const memberAthletes = new Set(members.map((m) => m.athlete_id));

  if (data.addAthleteIds.some((id) => data.removeAthleteIds.includes(id))) {
    throw unprocessable("An athlete can't be added and removed in the same change");
  }
  // An athlete already gone (or already in) is a no-op, so a change that
  // failed part-way can simply be sent again.
  const removes = data.removeAthleteIds.filter((id) => memberAthletes.has(id));
  const adds = data.addAthleteIds.filter((id) => !memberAthletes.has(id));
  const staying = members.filter((m) => !removes.includes(m.athlete_id));
  const size = staying.length + adds.length;
  if (size < 1) throw unprocessable("Delete the group lesson to remove everyone");
  if (size > GROUP_MAX_ATHLETES) throw unprocessable("A group lesson holds at most 8 athletes");
  await assertAllRostered(admin, coachId, adds);
  const target = data.schedule ? scheduleColumns(data.schedule) : members[0]!;
  // A move is checked for everyone who will be in the group; otherwise only
  // the athletes joining.
  const checked = data.schedule ? [...staying.map((m) => m.athlete_id), ...adds] : adds;
  await assertNoClash(admin, coachId, checked, target, groupId);

  // 1. Removals: those athletes' lessons (and their overrides) go.
  if (removes.length) {
    const del = await admin
      .from("athlete_lesson_slots")
      .delete()
      .eq("coach_id", coachId)
      .eq("group_id" as never, groupId)
      .in("athlete_id", removes);
    if (del.error) failWrite(del.error);
  }

  // 2. Schedule and price, for every remaining member in one UPDATE.
  const patch: Record<string, unknown> = {
    ...(data.schedule ? scheduleColumns(data.schedule) : {}),
    ...(data.priceCents !== undefined ? { price_cents: data.priceCents } : {}),
  };
  if (Object.keys(patch).length) {
    const upd = await admin
      .from("athlete_lesson_slots")
      .update(patch as never)
      .eq("coach_id", coachId)
      .eq("group_id" as never, groupId);
    if (upd.error) failWrite(upd.error);
  }

  // 3. Additions join on the group's (possibly just-moved) schedule. Their
  // price is the one in this change, else the group's when every member
  // shares one, else their usual rate.
  if (adds.length) {
    const first = members[0]!;
    const schedule = data.schedule
      ? scheduleColumns(data.schedule)
      : {
          day_of_week: first.day_of_week,
          start_minute: first.start_minute,
          end_minute: first.end_minute,
          frequency: first.frequency ?? "weekly",
          weeks_of_month: first.weeks_of_month ?? [],
          starts_on: first.starts_on,
        };
    const priced = staying.length ? staying : members;
    const shared = priced.every((m) => m.price_cents === priced[0]!.price_cents)
      ? priced[0]!.price_cents
      : null;
    const price = data.priceCents !== undefined ? data.priceCents : shared;
    const ins = await admin.from("athlete_lesson_slots").insert(
      adds.map((athleteId) => ({
        athlete_id: athleteId,
        coach_id: coachId,
        ...schedule,
        group_id: groupId,
        price_cents: price,
      })) as never,
    );
    if (ins.error) failWrite(ins.error);
  }

  // 4. One athlete left: it is a private lesson again. (Checked on every
  // change, so a re-sent change finishes what an earlier one started.)
  await dissolveGroupIfSingle(admin, groupId);
  return { ok: true as const };
}

/** `deleteLessonGroup`: remove the recurring group lesson for everyone (overrides go with it). */
export async function deleteLessonGroup(
  ctx: RosterContext,
  groupId: string,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  const coachId = await requireCoachId(admin, userId);
  await loadGroup(admin, coachId, groupId);
  const res = await admin
    .from("athlete_lesson_slots")
    .delete()
    .eq("coach_id", coachId)
    .eq("group_id" as never, groupId);
  if (res.error) failWrite(res.error);
  return { ok: true as const };
}

/**
 * `setGroupOccurrence`: one date of a group lesson. Replaces that date's
 * overrides for every member: an athlete in `out` is canceled (and billed
 * anyway when `billable`), everyone else is rescheduled when `reschedule` is
 * given, and otherwise has no override.
 */
export async function setGroupOccurrence(
  ctx: RosterContext,
  groupId: string,
  date: string,
  data: z.infer<typeof setGroupOccurrenceInput>,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  const coachId = await requireCoachId(admin, userId);
  const members = await loadGroup(admin, coachId, groupId);
  const slotByAthlete = new Map(members.map((m) => [m.athlete_id, m.id]));
  const outByAthlete = new Map(data.out.map((o) => [o.athleteId, o.billable]));
  if (data.out.some((o) => !slotByAthlete.has(o.athleteId))) {
    throw unprocessable("That athlete isn't in this group lesson");
  }

  const rows: Array<Record<string, unknown>> = [];
  const untouched: string[] = [];
  for (const m of members) {
    const billable = outByAthlete.get(m.athlete_id);
    if (billable !== undefined) {
      rows.push({
        slot_id: m.id,
        occurrence_date: date,
        status: "canceled",
        start_minute: null,
        end_minute: null,
        billable,
      });
    } else if (data.reschedule) {
      rows.push({
        slot_id: m.id,
        occurrence_date: date,
        status: "rescheduled",
        start_minute: data.reschedule.startMinute,
        end_minute: data.reschedule.endMinute,
        billable: false,
      });
    } else {
      untouched.push(m.id);
    }
  }

  if (rows.length) {
    const up = await admin
      .from("lesson_slot_overrides")
      .upsert(rows as never, { onConflict: "slot_id,occurrence_date" });
    if (up.error) failWrite(up.error);
  }
  if (untouched.length) {
    const del = await admin
      .from("lesson_slot_overrides")
      .delete()
      .in("slot_id", untouched)
      .eq("occurrence_date", date);
    if (del.error) failWrite(del.error);
  }
  return { ok: true as const };
}

/** `clearGroupOccurrence`: the date goes back to the regular lesson for everyone. */
export async function clearGroupOccurrence(
  ctx: RosterContext,
  groupId: string,
  date: string,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  const coachId = await requireCoachId(admin, userId);
  const members = await loadGroup(admin, coachId, groupId);
  const res = await admin
    .from("lesson_slot_overrides")
    .delete()
    .in(
      "slot_id",
      members.map((m) => m.id),
    )
    .eq("occurrence_date", date);
  if (res.error) failWrite(res.error);
  return { ok: true as const };
}
