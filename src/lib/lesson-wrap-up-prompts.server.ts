/**
 * Lesson wrap-up prompts (PRD §6.6 "Lesson wrap-up prompt (after a slot ends)").
 *
 * The web computes pending wrap-ups on read from the client's clock
 * (`getPendingLessonWrapUps`), so nothing server-side ever "notices" that a
 * lesson ended. This cron-driven pass does: every few minutes it finds
 * lesson-slot occurrences that ended within the last `WINDOW_MINUTES`
 * (America/New_York, like lesson reminders), skips any the coach already
 * wrapped up, records the occurrence in `lesson_wrap_up_prompts_sent` (the
 * dedupe boundary, same shape as `lesson_reminders_sent`), and pushes the
 * coach with the `coach/wrap-ups` route. The prompt card itself keeps
 * coming from the read-time computation; this only taps the coach on the
 * shoulder.
 *
 * Group lessons (PRD §6.16 F, decision #68): the members of a group that
 * ended together are one prompt and one push. Every member's slot still gets
 * its own dedupe row, so the table and its key are unchanged; the group's
 * push goes out when any of those rows is new this tick.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { liveGroupsAmong, resolveOccurrenceTimes } from "./coach-day-lessons.server";
import { dbError } from "./db-error";
import { nowInRinkTz } from "./lesson-reminders.server";
import { expandSlotOccurrences, type LessonFrequency } from "./lesson-recurrence";
import { notifyUsers, type PushDeps } from "./push-notify.server";

type Client = SupabaseClient<Database>;

export type WrapUpPromptContext = { admin: Client; push?: PushDeps };
export type WrapUpPromptResult = { scanned: number; prompted: number; sent: number };

/** A lesson that ended up to this many minutes ago is still "just ended". Two cron ticks wide so a missed tick is not a missed prompt. */
export const WINDOW_MINUTES = 10;

type SlotRow = {
  id: string;
  coach_id: string | null;
  athlete_id: string;
  day_of_week: number;
  start_minute: number;
  end_minute: number;
  frequency: string | null;
  weeks_of_month: number[] | null;
  starts_on: string | null;
  group_id?: string | null;
};

type DbError = { code?: string; message: string };
const missingColumn = (e: DbError | null) => e?.code === "42703" || e?.code === "PGRST204";

/** "Greta, Tobin, Ines" / "Greta, Tobin, Ines +5", the Schedule card's title. */
export function groupNames(firstNames: string[]): string {
  const shown = firstNames.slice(0, 3).join(", ");
  return firstNames.length > 3 ? `${shown} +${firstNames.length - 3}` : shown;
}

type OverrideRow = {
  slot_id: string;
  occurrence_date: string;
  status: string;
  start_minute: number | null;
  end_minute: number | null;
};

export async function computeLessonWrapUpPrompts(
  ctx: WrapUpPromptContext,
  now: Date = new Date(),
): Promise<WrapUpPromptResult> {
  const { admin } = ctx;
  const { dateIso, minutes: nowMinutes, dayOfWeek } = nowInRinkTz(now);

  const COLUMNS =
    "id, coach_id, athlete_id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on";
  const selectSlots = async (columns: string) =>
    (await admin
      .from("athlete_lesson_slots")
      .select(columns)
      .eq("day_of_week", dayOfWeek)) as unknown as {
      data: SlotRow[] | null;
      error: DbError | null;
    };
  let slotsRes = await selectSlots(`${COLUMNS}, group_id`);
  // No `group_id` column until migration 20261115120000: every lesson is private.
  if (missingColumn(slotsRes.error)) slotsRes = await selectSlots(COLUMNS);
  if (slotsRes.error) dbError(slotsRes.error);
  const slots = (slotsRes.data ?? []).filter((s) => !!s.coach_id);
  // A group is real with two or more slots; a lone leftover link is a private lesson.
  const liveGroups = liveGroupsAmong(slots);
  const scanned = slots.length;
  if (scanned === 0) return { scanned: 0, prompted: 0, sent: 0 };

  // Only slots that actually occur today (biweekly / monthly cadences skip weeks).
  const active = slots.filter(
    (s) =>
      expandSlotOccurrences(
        {
          dayOfWeek: s.day_of_week,
          frequency: (s.frequency as LessonFrequency) || "weekly",
          weeksOfMonth: s.weeks_of_month ?? [],
          startsOn: s.starts_on,
        },
        dateIso,
        dateIso,
      ).length > 0,
  );
  if (active.length === 0) return { scanned, prompted: 0, sent: 0 };

  const overridesRes = await admin
    .from("lesson_slot_overrides")
    .select("slot_id, occurrence_date, status, start_minute, end_minute")
    .in(
      "slot_id",
      active.map((s) => s.id),
    )
    .eq("occurrence_date", dateIso);
  if (overridesRes.error) dbError(overridesRes.error);
  const overrideBySlot = new Map<string, OverrideRow>();
  for (const o of (overridesRes.data ?? []) as unknown as OverrideRow[])
    overrideBySlot.set(o.slot_id, o);

  // Prompt when the lesson actually ends: its rescheduled time if it moved,
  // the moment the read-time card (`getCoachLessonsOn`) starts showing it.
  const justEnded = active.filter((s) => {
    const times = resolveOccurrenceTimes(s, overrideBySlot.get(s.id));
    if (!times) return false; // canceled
    const ago = nowMinutes - times.endMinute;
    return ago >= 0 && ago < WINDOW_MINUTES;
  });
  if (justEnded.length === 0) return { scanned, prompted: 0, sent: 0 };

  // The coach may already have wrapped this lesson up from the read-time card.
  const wrappedRes = await admin
    .from("lesson_wrap_ups")
    .select("coach_id, athlete_id")
    .eq("lesson_date", dateIso)
    .in(
      "athlete_id",
      justEnded.map((s) => s.athlete_id),
    );
  if (wrappedRes.error) dbError(wrappedRes.error);
  const wrapped = new Set(
    ((wrappedRes.data ?? []) as { coach_id: string; athlete_id: string }[]).map(
      (r) => `${r.coach_id}|${r.athlete_id}`,
    ),
  );
  const toPrompt = justEnded.filter((s) => !wrapped.has(`${s.coach_id}|${s.athlete_id}`));
  if (toPrompt.length === 0) return { scanned, prompted: 0, sent: 0 };

  // Dedupe boundary against a concurrent tick — see lesson-reminders.server.ts.
  // Not in the generated Database types until Lovable regenerates them after
  // the migration is applied; the board tables use the same untyped handle.
  const bookkeeping = admin as unknown as { from: (table: string) => any };
  const upsertRes = await bookkeeping
    .from("lesson_wrap_up_prompts_sent")
    .upsert(
      toPrompt.map((s) => ({
        slot_id: s.id,
        coach_id: s.coach_id as string,
        athlete_id: s.athlete_id,
        lesson_date: dateIso,
        sent_at: now.toISOString(),
      })),
      { onConflict: "slot_id,lesson_date", ignoreDuplicates: true },
    )
    .select("slot_id, lesson_date");
  if (upsertRes.error && (upsertRes.error as { code?: string }).code !== "23505") {
    dbError(upsertRes.error);
  }
  const insertedSlotIds = new Set(
    ((upsertRes.data ?? []) as { slot_id: string }[]).map((r) => r.slot_id),
  );
  const fresh = toPrompt.filter((s) => insertedSlotIds.has(s.id));
  if (fresh.length === 0) return { scanned, prompted: 0, sent: 0 };

  const coachIds = Array.from(new Set(fresh.map((s) => s.coach_id as string)));
  // Names for every athlete still to wrap up: a group's push names them all.
  const athleteIds = Array.from(new Set(toPrompt.map((s) => s.athlete_id)));
  const [coachesRes, athletesRes] = await Promise.all([
    admin.from("coach_profiles").select("id, user_id").in("id", coachIds),
    admin.from("athletes").select("id, first_name, last_name").in("id", athleteIds),
  ]);
  if (coachesRes.error) dbError(coachesRes.error);
  if (athletesRes.error) dbError(athletesRes.error);
  const coachUserById = new Map<string, string | null>();
  for (const c of (coachesRes.data ?? []) as { id: string; user_id: string | null }[]) {
    coachUserById.set(c.id, c.user_id);
  }
  const athleteFirstNameById = new Map<string, string>();
  const athleteNameById = new Map<string, string>();
  for (const a of (athletesRes.data ?? []) as {
    id: string;
    first_name: string | null;
    last_name: string | null;
  }[]) {
    athleteFirstNameById.set(a.id, (a.first_name ?? "").trim());
    athleteNameById.set(
      a.id,
      `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "Your athlete",
    );
  }

  // One prompt per lesson: a private lesson on its own, a group's members
  // that ended at the same minute together.
  const endBySlot = new Map<string, number>();
  for (const s of justEnded) {
    const times = resolveOccurrenceTimes(s, overrideBySlot.get(s.id));
    if (times) endBySlot.set(s.id, times.endMinute);
  }
  const unitKey = (s: SlotRow) =>
    s.group_id && liveGroups.has(s.group_id)
      ? `group:${s.coach_id}:${s.group_id}:${endBySlot.get(s.id)}`
      : `slot:${s.id}`;
  // Everyone in the unit still to wrap up, whether or not their row is new, so
  // a retried tick names the same athletes the first one would have.
  const units = new Map<string, SlotRow[]>();
  for (const s of toPrompt) {
    const key = unitKey(s);
    units.set(key, [...(units.get(key) ?? []), s]);
  }
  const freshKeys = new Set(fresh.map(unitKey));

  let sent = 0;
  let prompted = 0;
  for (const [key, members] of units) {
    if (!freshKeys.has(key)) continue;
    prompted += 1;
    const first = members[0];
    const coachUser = coachUserById.get(first.coach_id as string) ?? null;
    if (!coachUser) continue;
    const isGroup = members.length > 1;
    const firstNames = members
      .map((m) => athleteFirstNameById.get(m.athlete_id) ?? "")
      .filter((n) => n.length > 0)
      .sort((x, y) => x.localeCompare(y));
    const body = !isGroup
      ? `${athleteNameById.get(first.athlete_id) ?? "Your athlete"}'s lesson just ended. Edit, redeploy, or dismiss their plan.`
      : firstNames.length > 0
        ? `Group lesson with ${groupNames(firstNames)} just ended. Edit, redeploy, or dismiss their plans.`
        : "Your group lesson just ended. Edit, redeploy, or dismiss their plans.";
    const report = await notifyUsers(
      admin,
      [coachUser],
      {
        type: "lesson_wrap_up",
        route: "coach/wrap-ups",
        title: "Lesson wrap-up",
        body,
        // The end minute keeps two halves of a group that ended apart from replacing each other.
        collapseId: isGroup
          ? `wrapup:group:${first.group_id}:${dateIso}:${endBySlot.get(first.id)}`
          : `wrapup:${first.id}:${dateIso}`,
        // A private lesson's inbox row is tied to its athlete, so it goes when
        // the athlete does. A group's names several athletes and can be tied
        // to none, so it stays out of the inbox: the push and the Roster's
        // prompt carry it.
        ...(isGroup ? { inbox: false } : { athleteId: first.athlete_id }),
      },
      ctx.push,
    );
    sent += report.sent;
    // Nothing got through and a failure was transient: release the dedupe rows so
    // the next tick inside the window retries.
    if (report.sent === 0 && report.failed - report.pruned > 0) {
      for (const m of members) {
        await bookkeeping
          .from("lesson_wrap_up_prompts_sent")
          .delete()
          .eq("slot_id", m.id)
          .eq("lesson_date", dateIso);
      }
    }
  }

  return { scanned, prompted, sent };
}
