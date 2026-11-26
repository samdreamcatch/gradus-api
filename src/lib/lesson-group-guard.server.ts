/**
 * What a parent or athlete may know and do about a group lesson (PRD
 * decision #68, §6.16 G): they see that their lesson is a group lesson and
 * nothing else about the group, and the lesson is the coach's to change.
 *
 * Kept apart from `lesson-groups.server.ts` (coach-only) so the parent and
 * athlete modules import no coach code.
 */
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";

type Admin = typeof supabaseAdmin;

export type GroupedSlotTime = {
  athleteId: string;
  coachId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
};

type DbError = { code?: string; message: string };
const missingColumn = (e: DbError | null) => e?.code === "42703" || e?.code === "PGRST204";

/**
 * Which of these group ids are real groups: two or more slots share them. A
 * lone slot still carrying a group id (its partners left through a roster
 * removal, an account deletion, a family deleting their lesson) is a private
 * lesson everywhere it is read, and its link is cleared the next time the
 * coach edits it.
 */
export async function liveGroupIds(admin: Admin, groupIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(groupIds)];
  if (ids.length === 0) return new Set();
  const res = (await admin
    .from("athlete_lesson_slots")
    .select("group_id")
    .in("group_id" as never, ids)) as unknown as {
    data: Array<{ group_id: string | null }> | null;
    error: DbError | null;
  };
  if (missingColumn(res.error)) return new Set();
  if (res.error) dbError(res.error);
  const sizes = new Map<string, number>();
  for (const r of res.data ?? []) {
    if (r.group_id) sizes.set(r.group_id, (sizes.get(r.group_id) ?? 0) + 1);
  }
  return new Set([...sizes].filter(([, n]) => n >= 2).map(([id]) => id));
}

type SlotTimeLike = { dayOfWeek: number; startMinute: number; endMinute: number };

/**
 * These athletes' lesson slots that belong to a group, by time. Empty before
 * migration 20261115120000 is applied (no `group_id` column yet).
 */
export async function groupedSlotTimes(
  admin: Admin,
  athleteIds: string[],
): Promise<GroupedSlotTime[]> {
  if (athleteIds.length === 0) return [];
  const res = (await admin
    .from("athlete_lesson_slots")
    .select("athlete_id, coach_id, day_of_week, start_minute, end_minute, group_id")
    .in("athlete_id", athleteIds)) as unknown as {
    data: Array<{
      athlete_id: string;
      coach_id: string | null;
      day_of_week: number;
      start_minute: number;
      end_minute: number;
      group_id?: string | null;
    }> | null;
    error: { code?: string; message: string } | null;
  };
  if (res.error?.code === "42703" || res.error?.code === "PGRST204") return [];
  if (res.error) dbError(res.error);
  const live = await liveGroupIds(
    admin,
    (res.data ?? []).map((r) => r.group_id).filter((id): id is string => id != null),
  );
  return (res.data ?? [])
    .filter((r) => r.group_id != null && live.has(r.group_id) && r.coach_id != null)
    .map((r) => ({
      athleteId: r.athlete_id,
      coachId: r.coach_id as string,
      dayOfWeek: r.day_of_week,
      startMinute: r.start_minute,
      endMinute: r.end_minute,
    }));
}

/** Whether this athlete's slot with this coach, at this time, is a group lesson. */
export function isGroupedSlot(
  grouped: GroupedSlotTime[],
  athleteId: string,
  coachId: string,
  slot: SlotTimeLike,
): boolean {
  return grouped.some(
    (g) =>
      g.athleteId === athleteId &&
      g.coachId === coachId &&
      g.dayOfWeek === slot.dayOfWeek &&
      g.startMinute === slot.startMinute &&
      g.endMinute === slot.endMinute,
  );
}

/** `{ group: true }` for a group lesson, nothing otherwise: the only thing a family learns about a group. */
export function groupFlag(
  grouped: GroupedSlotTime[],
  athleteId: string,
  coachId: string,
  slot: SlotTimeLike,
): { group?: boolean } {
  return isGroupedSlot(grouped, athleteId, coachId, slot) ? { group: true } : {};
}

type Recurring = {
  day_of_week: number;
  start_minute: number;
  end_minute: number;
  frequency: string | null;
  weeks_of_month: number[] | null;
  starts_on: string | null;
};

/**
 * Whether two recurring lessons can fall on the same date at overlapping
 * times. Cadences that provably never meet (every other week on opposite
 * weeks; different weeks of the month) don't coincide; anything unclear does.
 */
export function slotsCoincide(a: Recurring, b: Recurring): boolean {
  if (a.day_of_week !== b.day_of_week) return false;
  if (!(a.start_minute < b.end_minute && b.start_minute < a.end_minute)) return false;
  const fa = a.frequency ?? "weekly";
  const fb = b.frequency ?? "weekly";
  if (fa === "biweekly" && fb === "biweekly" && a.starts_on && b.starts_on) {
    const days = Math.round((Date.parse(a.starts_on) - Date.parse(b.starts_on)) / 86_400_000);
    return Math.abs(Math.round(days / 7)) % 2 === 0;
  }
  const monthly = (f: string) => f === "monthly" || f === "twice_monthly";
  if (monthly(fa) && monthly(fb)) {
    const weeks = new Set((a.weeks_of_month ?? []).map(Number));
    return (b.weeks_of_month ?? []).some((w) => weeks.has(Number(w)));
  }
  return true;
}

export type FamilySlotInput = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  frequency: string;
  weeksOfMonth: number[];
  startsOn: string | null;
};

type FamilySlotRow = {
  id: string;
  day_of_week: number;
  start_minute: number;
  end_minute: number;
  frequency: string | null;
  weeks_of_month: number[] | null;
  starts_on: string | null;
  group_id?: string | null;
};

const sameWeeks = (a: number[], b: number[]) =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/**
 * A family replaces one athlete's lessons with one coach (or the coach-less
 * ones when `coachId` is null). Used by every family schedule save.
 *
 * - A group lesson is the coach's to change (decision #68): it stays, a
 *   submitted copy of it is dropped, and a submitted lesson that overlaps it
 *   is refused rather than added beside it.
 * - A lesson the family left unchanged keeps its row, so its canceled and
 *   rescheduled dates (and a "still bill" on a canceled one) survive the save.
 */
export async function replaceFamilySlots(
  admin: Admin,
  athleteId: string,
  coachId: string | null,
  slots: FamilySlotInput[],
): Promise<void> {
  const COLUMNS = "id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on";
  const run = (columns: string) => {
    const q = admin.from("athlete_lesson_slots").select(columns).eq("athlete_id", athleteId);
    return (coachId ? q.eq("coach_id", coachId) : q.is("coach_id", null)) as unknown as Promise<{
      data: FamilySlotRow[] | null;
      error: DbError | null;
    }>;
  };
  let res = await run(`${COLUMNS}, group_id`);
  if (missingColumn(res.error)) res = await run(COLUMNS);
  if (res.error) dbError(res.error);
  const rows = res.data ?? [];

  const live = await liveGroupIds(
    admin,
    rows.map((r) => r.group_id).filter((id): id is string => id != null),
  );
  const grouped = rows.filter((r) => r.group_id != null && live.has(r.group_id));
  const own = rows.filter((r) => !(r.group_id != null && live.has(r.group_id)));

  const wanted = slots.map((s) => ({
    day_of_week: s.dayOfWeek,
    start_minute: s.startMinute,
    end_minute: s.endMinute,
    frequency: s.frequency,
    weeks_of_month: s.frequency === "biweekly" || s.frequency === "weekly" ? [] : s.weeksOfMonth,
    starts_on: s.frequency === "biweekly" ? s.startsOn : null,
  }));

  // 1. A lesson the family left exactly as it was keeps its row. Matched
  // first, so a lesson that already sits beside a group lesson (the coach put
  // it there) never blocks the save.
  const sameCadence = (r: FamilySlotRow, w: (typeof wanted)[number]) =>
    (r.frequency ?? "weekly") === w.frequency &&
    sameWeeks((r.weeks_of_month ?? []).map(Number), w.weeks_of_month) &&
    (r.starts_on ?? null) === w.starts_on;
  const unmatched = [...own];
  const changed: typeof wanted = [];
  for (const w of wanted) {
    const i = unmatched.findIndex(
      (r) =>
        r.day_of_week === w.day_of_week &&
        r.start_minute === w.start_minute &&
        r.end_minute === w.end_minute &&
        sameCadence(r, w),
    );
    if (i >= 0) unmatched.splice(i, 1);
    else changed.push(w);
  }

  // 2. What is left is new or moved. A copy of the group lesson is dropped;
  // a lesson that would land on top of it is refused.
  const toInsert: typeof wanted = [];
  for (const w of changed) {
    const clash = grouped.find((g) => slotsCoincide(g, w));
    if (!clash) toInsert.push(w);
    else if (clash.start_minute !== w.start_minute || clash.end_minute !== w.end_minute) {
      throw new ApiError({
        code: "unprocessable",
        status: 422,
        message: "That time overlaps a group lesson. Your coach sets the group lesson's time.",
      });
    }
  }

  if (unmatched.length > 0) {
    const del = await admin
      .from("athlete_lesson_slots")
      .delete()
      .in(
        "id",
        unmatched.map((r) => r.id),
      );
    if (del.error) dbError(del.error);
  }
  if (toInsert.length > 0) {
    const ins = await admin
      .from("athlete_lesson_slots")
      .insert(toInsert.map((w) => ({ athlete_id: athleteId, coach_id: coachId, ...w })));
    if (ins.error) dbError(ins.error);
  }
}
