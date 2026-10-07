/**
 * A coach's lessons on one calendar day, as they actually happen: only slots
 * whose recurrence lands on that date (biweekly, twice-monthly and monthly
 * cadences skip weeks), canceled occurrences dropped, rescheduled ones at their
 * new times. Shared by "up next" (`getUpNext`) and pending wrap-ups
 * (`getPendingLessonWrapUps`), so the two never disagree about whether, or
 * when, a lesson happens today.
 *
 * Takes either the service-role client or the caller's RLS client: a coach can
 * read their own slots and those slots' overrides.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import { expandSlotOccurrences, type LessonFrequency } from "./lesson-recurrence";

export type DayLesson = {
  slotId: string;
  athleteId: string;
  /** Effective times: a rescheduled occurrence's, otherwise the slot's own. */
  startMinute: number;
  endMinute: number;
};

export type OccurrenceOverride = {
  status: string;
  start_minute: number | null;
  end_minute: number | null;
};

/** One occurrence's effective times, or null when it is canceled. */
export function resolveOccurrenceTimes(
  slot: { start_minute: number; end_minute: number },
  override: OccurrenceOverride | undefined,
): { startMinute: number; endMinute: number } | null {
  if (override?.status === "canceled") return null;
  if (
    override?.status === "rescheduled" &&
    override.start_minute != null &&
    override.end_minute != null
  ) {
    return { startMinute: override.start_minute, endMinute: override.end_minute };
  }
  return { startMinute: slot.start_minute, endMinute: slot.end_minute };
}

type SlotRow = {
  id: string;
  athlete_id: string;
  start_minute: number;
  end_minute: number;
  frequency: string;
  weeks_of_month: number[] | null;
  starts_on: string | null;
};

type OverrideRow = OccurrenceOverride & { slot_id: string };

/**
 * `getCoachLessonsOn`: every lesson the coach has on `lessonDate`, in no
 * particular order. Ended or not is the caller's call, made on `endMinute`
 * (a lesson whose base time has passed may have been rescheduled later, and
 * the other way round).
 */
export async function getCoachLessonsOn(
  client: SupabaseClient<Database>,
  coachId: string,
  day: { lessonDate: string; dayOfWeek: number },
): Promise<DayLesson[]> {
  const slotsRes = await client
    .from("athlete_lesson_slots")
    .select("id, athlete_id, start_minute, end_minute, frequency, weeks_of_month, starts_on")
    .eq("coach_id", coachId)
    .eq("day_of_week", day.dayOfWeek);
  if (slotsRes.error) dbError(slotsRes.error);

  const occurring = ((slotsRes.data ?? []) as unknown as SlotRow[]).filter(
    (s) =>
      expandSlotOccurrences(
        {
          dayOfWeek: day.dayOfWeek,
          frequency: (s.frequency as LessonFrequency) || "weekly",
          weeksOfMonth: s.weeks_of_month ?? [],
          startsOn: s.starts_on,
        },
        day.lessonDate,
        day.lessonDate,
      ).length > 0,
  );
  if (occurring.length === 0) return [];

  const overridesRes = await client
    .from("lesson_slot_overrides")
    .select("slot_id, status, start_minute, end_minute")
    .in(
      "slot_id",
      occurring.map((s) => s.id),
    )
    .eq("occurrence_date", day.lessonDate);
  if (overridesRes.error) dbError(overridesRes.error);
  const overrideBySlot = new Map<string, OverrideRow>();
  for (const o of (overridesRes.data ?? []) as unknown as OverrideRow[]) {
    overrideBySlot.set(o.slot_id, o);
  }

  return occurring.flatMap((s) => {
    const times = resolveOccurrenceTimes(s, overrideBySlot.get(s.id));
    return times ? [{ slotId: s.id, athleteId: s.athlete_id, ...times }] : [];
  });
}
