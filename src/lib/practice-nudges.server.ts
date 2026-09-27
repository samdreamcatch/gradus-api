/**
 * Practice nudge (PRD §6.6 "Practice nudge (three days after a lesson)").
 *
 * Called every 15 minutes by pg_cron via `POST /api/public/hooks/practice-nudges`.
 * Three days after an athlete's lesson, if nobody has logged a practice
 * session since it started, push the athlete and their guardians a reminder
 * to practice. "Three days after" is the lesson's start time three days
 * later (America/New_York, like lesson reminders), held to 08:00-20:00 so a
 * 6am lesson doesn't become a 6am push and a late one still lands that
 * evening.
 *
 * No nudge when:
 * - the slot didn't exist yet on the lesson date (a lesson added on Wednesday
 *   for Mondays has no "last Monday"; schedule saves re-insert slots, so a
 *   nudge can be missed for three days after an edit, never falsely sent);
 * - the athlete has had another lesson since (that one is now their last);
 * - a practice session was logged since the lesson started;
 * - the athlete has no active plan (there is nothing to log against).
 *
 * `practice_nudges_sent` is the dedupe boundary, one row per (athlete,
 * lesson date), the same shape as `lesson_reminders_sent`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import {
  addDays,
  expandSlotOccurrences,
  parseIsoDate,
  toIsoDate,
  type LessonFrequency,
} from "./lesson-recurrence";
import { nowInRinkTz } from "./lesson-reminders.server";
import { athleteHouseholdUserIds, notifyUsers, type PushDeps } from "./push-notify.server";

type Client = SupabaseClient<Database>;

export type PracticeNudgeContext = { admin: Client; push?: PushDeps };
export type PracticeNudgeResult = { scanned: number; prompted: number; sent: number };

/** Days after the lesson before the nudge. */
export const NUDGE_AFTER_DAYS = 3;
/** The nudge goes out at the lesson's start time, held inside these minutes of the day. */
const EARLIEST_MINUTE = 8 * 60;
const LATEST_MINUTE = 20 * 60;
/** Athletes pushed per tick, so one crowded tick stays inside the Worker's limits; the next tick takes the rest. */
export const MAX_PER_TICK = 25;

const SLOT_COLUMNS =
  "id, coach_id, athlete_id, day_of_week, start_minute, frequency, weeks_of_month, starts_on, created_at";

type SlotRow = {
  id: string;
  coach_id: string | null;
  athlete_id: string;
  day_of_week: number;
  start_minute: number;
  frequency: string | null;
  weeks_of_month: number[] | null;
  starts_on: string | null;
  created_at?: string | null;
};

type OverrideRow = {
  slot_id: string;
  occurrence_date: string;
  status: string;
  start_minute: number | null;
};

type Occurrence = { athleteId: string; date: string; startMinute: number };

/** The minute of the day the nudge for a lesson starting at `startMinute` goes out. */
export function nudgeMinute(startMinute: number): number {
  return Math.min(LATEST_MINUTE, Math.max(EARLIEST_MINUTE, startMinute));
}

/** Every occurrence of `slots` in `[startIso, endIso]`, with cancellations dropped and reschedules applied. */
async function occurrencesBetween(
  admin: Client,
  slots: SlotRow[],
  startIso: string,
  endIso: string,
): Promise<Occurrence[]> {
  const raw: { slot: SlotRow; date: string }[] = [];
  // A coach unlinked from the roster leaves the slot with a null coach_id
  // (coach-roster.server.ts); that is a schedule on hold, not a lesson.
  for (const s of slots.filter((slot) => slot.coach_id)) {
    // The template only describes the schedule from the day it was saved.
    const createdIso = s.created_at ? nowInRinkTz(new Date(s.created_at)).dateIso : null;
    const dates = expandSlotOccurrences(
      {
        dayOfWeek: s.day_of_week,
        frequency: (s.frequency as LessonFrequency) || "weekly",
        weeksOfMonth: s.weeks_of_month ?? [],
        startsOn: s.starts_on,
      },
      startIso,
      endIso,
    );
    for (const date of dates) if (!createdIso || date >= createdIso) raw.push({ slot: s, date });
  }
  if (raw.length === 0) return [];

  const overridesRes = await admin
    .from("lesson_slot_overrides")
    .select("slot_id, occurrence_date, status, start_minute")
    .in("slot_id", Array.from(new Set(raw.map((r) => r.slot.id))))
    .gte("occurrence_date", startIso)
    .lte("occurrence_date", endIso);
  if (overridesRes.error) dbError(overridesRes.error);
  const overrides = new Map<string, OverrideRow>();
  for (const o of (overridesRes.data ?? []) as unknown as OverrideRow[]) {
    overrides.set(`${o.slot_id}|${o.occurrence_date}`, o);
  }

  const out: Occurrence[] = [];
  for (const { slot, date } of raw) {
    const override = overrides.get(`${slot.id}|${date}`);
    if (override?.status === "canceled") continue;
    const startMinute =
      override?.status === "rescheduled" && override.start_minute != null
        ? override.start_minute
        : slot.start_minute;
    out.push({ athleteId: slot.athlete_id, date, startMinute });
  }
  return out;
}

export async function computePracticeNudges(
  ctx: PracticeNudgeContext,
  now: Date = new Date(),
): Promise<PracticeNudgeResult> {
  const { admin } = ctx;
  const { dateIso: todayIso, minutes: nowMinutes } = nowInRinkTz(now);
  const lessonIso = toIsoDate(addDays(parseIsoDate(todayIso), -NUDGE_AFTER_DAYS));

  // 1) Lessons on the lesson date. With two that day, the later one is the last lesson.
  const daySlotsRes = await admin
    .from("athlete_lesson_slots")
    .select(SLOT_COLUMNS)
    .eq("day_of_week", parseIsoDate(lessonIso).getDay());
  if (daySlotsRes.error) dbError(daySlotsRes.error);
  const onLessonDay = await occurrencesBetween(
    admin,
    (daySlotsRes.data ?? []) as unknown as SlotRow[],
    lessonIso,
    lessonIso,
  );
  const lastStartByAthlete = new Map<string, number>();
  for (const o of onLessonDay) {
    lastStartByAthlete.set(
      o.athleteId,
      Math.max(lastStartByAthlete.get(o.athleteId) ?? -1, o.startMinute),
    );
  }
  let due = Array.from(lastStartByAthlete.entries())
    .filter(([, start]) => nudgeMinute(start) <= nowMinutes)
    .map(([athleteId, start]) => ({ athleteId, start }));
  const scanned = due.length;
  if (scanned === 0) return { scanned: 0, prompted: 0, sent: 0 };

  // Already nudged for this lesson date on an earlier tick: skip the rest of the work.
  // Not in the generated Database types until Lovable regenerates them after
  // the migration is applied; the board tables use the same untyped handle.
  const bookkeeping = admin as unknown as { from: (table: string) => any };
  const doneRes = await bookkeeping
    .from("practice_nudges_sent")
    .select("athlete_id")
    .eq("lesson_date", lessonIso)
    .in(
      "athlete_id",
      due.map((d) => d.athleteId),
    );
  if (doneRes.error) dbError(doneRes.error);
  const done = new Set(((doneRes.data ?? []) as { athlete_id: string }[]).map((r) => r.athlete_id));
  due = due.filter((d) => !done.has(d.athleteId));
  if (due.length === 0) return { scanned, prompted: 0, sent: 0 };

  // 2) Drop anyone with a lesson since, on any slot, up to now.
  const athleteIds = due.map((d) => d.athleteId);
  const allSlotsRes = await admin
    .from("athlete_lesson_slots")
    .select(SLOT_COLUMNS)
    .in("athlete_id", athleteIds);
  if (allSlotsRes.error) dbError(allSlotsRes.error);
  const since = await occurrencesBetween(
    admin,
    (allSlotsRes.data ?? []) as unknown as SlotRow[],
    toIsoDate(addDays(parseIsoDate(lessonIso), 1)),
    todayIso,
  );
  const hadLessonSince = new Set(
    since.filter((o) => o.date < todayIso || o.startMinute <= nowMinutes).map((o) => o.athleteId),
  );
  due = due.filter((d) => !hadLessonSince.has(d.athleteId));
  if (due.length === 0) return { scanned, prompted: 0, sent: 0 };

  // 3) Only athletes with an active plan: a session is always logged against one.
  const plansRes = await admin
    .from("plans")
    .select("athlete_id")
    .in(
      "athlete_id",
      due.map((d) => d.athleteId),
    )
    .eq("kind", "plan")
    .eq("status", "active");
  if (plansRes.error) dbError(plansRes.error);
  const withActivePlan = new Set(
    ((plansRes.data ?? []) as { athlete_id: string }[]).map((p) => p.athlete_id),
  );
  due = due.filter((d) => withActivePlan.has(d.athleteId));
  if (due.length === 0) return { scanned, prompted: 0, sent: 0 };

  // 4) Drop anyone who logged practice since the lesson started. The start
  // instant is "now" wound back by the wall-clock distance, which is off by
  // an hour across a DST change; a session that close to the lesson is rare.
  const lessonStartMs = (start: number) =>
    now.getTime() - (NUDGE_AFTER_DAYS * 1440 + nowMinutes - start) * 60_000;
  const earliest = Math.min(...due.map((d) => lessonStartMs(d.start)));
  const sessionsRes = await admin
    .from("plan_sessions")
    .select("athlete_id, logged_at")
    .in(
      "athlete_id",
      due.map((d) => d.athleteId),
    )
    .gte("logged_at", new Date(earliest).toISOString());
  if (sessionsRes.error) dbError(sessionsRes.error);
  const latestLog = new Map<string, number>();
  for (const s of (sessionsRes.data ?? []) as { athlete_id: string; logged_at: string }[]) {
    const at = Date.parse(s.logged_at);
    if (at > (latestLog.get(s.athlete_id) ?? -Infinity)) latestLog.set(s.athlete_id, at);
  }
  due = due
    .filter((d) => (latestLog.get(d.athleteId) ?? -Infinity) < lessonStartMs(d.start))
    .slice(0, MAX_PER_TICK);
  if (due.length === 0) return { scanned, prompted: 0, sent: 0 };

  // 5) Dedupe boundary against a concurrent tick — see lesson-reminders.server.ts.
  const upsertRes = await bookkeeping
    .from("practice_nudges_sent")
    .upsert(
      due.map((d) => ({
        athlete_id: d.athleteId,
        lesson_date: lessonIso,
        sent_at: now.toISOString(),
      })),
      { onConflict: "athlete_id,lesson_date", ignoreDuplicates: true },
    )
    .select("athlete_id");
  if (upsertRes.error && (upsertRes.error as { code?: string }).code !== "23505") {
    dbError(upsertRes.error);
  }
  const fresh = new Set(
    ((upsertRes.data ?? []) as { athlete_id: string }[]).map((r) => r.athlete_id),
  );
  const toNudge = due.filter((d) => fresh.has(d.athleteId));
  if (toNudge.length === 0) return { scanned, prompted: 0, sent: 0 };

  const athletesRes = await admin
    .from("athletes")
    .select("id, user_id, first_name, account_state")
    .in(
      "id",
      toNudge.map((d) => d.athleteId),
    );
  if (athletesRes.error) dbError(athletesRes.error);
  type AthleteRow = {
    id: string;
    user_id: string | null;
    first_name: string | null;
    account_state: string | null;
  };
  const athleteById = new Map<string, AthleteRow>();
  for (const a of (athletesRes.data ?? []) as AthleteRow[]) {
    athleteById.set(a.id, a);
  }

  // 6) The athlete's own login reads "your lesson"; guardians read "{Name}'s lesson".
  let sent = 0;
  for (const d of toNudge) {
    const athlete = athleteById.get(d.athleteId);
    const firstName = athlete?.first_name?.trim() || "your athlete";
    const guardians = await athleteHouseholdUserIds(admin, d.athleteId, { includeAthlete: false });
    const collapseId = `practice:${d.athleteId}:${lessonIso}`;
    let delivered = 0;
    let transient = 0;
    // A paused login (consent rescinded, PRD §6.13) hears nothing; guardians still do.
    if (athlete?.user_id && athlete.account_state !== "paused") {
      const r = await notifyUsers(
        admin,
        [athlete.user_id],
        {
          type: "practice_nudge",
          route: "plans",
          title: "Time to practice?",
          body: `It's been ${NUDGE_AFTER_DAYS} days since your lesson. Log a practice session to keep your plan moving.`,
          collapseId,
        },
        ctx.push,
      );
      delivered += r.sent;
      transient += r.failed - r.pruned;
    }
    const others = guardians.filter((id) => id !== athlete?.user_id);
    if (others.length) {
      const r = await notifyUsers(
        admin,
        others,
        {
          type: "practice_nudge",
          route: "plans",
          title: "Time to practice?",
          body: `It's been ${NUDGE_AFTER_DAYS} days since ${firstName}'s lesson. Log a practice session to keep their plan moving.`,
          collapseId,
        },
        ctx.push,
      );
      delivered += r.sent;
      transient += r.failed - r.pruned;
    }
    sent += delivered;
    // Nothing got through and a failure was transient: release the dedupe row
    // so the next tick retries.
    if (delivered === 0 && transient > 0) {
      await bookkeeping
        .from("practice_nudges_sent")
        .delete()
        .eq("athlete_id", d.athleteId)
        .eq("lesson_date", lessonIso);
    }
  }

  return { scanned, prompted: toNudge.length, sent };
}
