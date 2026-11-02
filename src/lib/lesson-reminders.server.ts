/**
 * Lesson-reminder compute + dedupe pipeline (PRD §3.8, §6.6).
 *
 * Called every 5 minutes by pg_cron (see the `lesson-reminders-every-5-min`
 * migration) via the `POST /api/public/hooks/lesson-reminders` route. This
 * module does the actual work so it can be unit-tested without a live
 * database: given "now", it finds every recurring lesson-slot occurrence
 * landing 10-15 minutes out, skips anything already recorded in
 * `lesson_reminders_sent`, and pushes the coach an "up next" nudge that opens
 * Roster with the Up next briefing already open.
 *
 * Coach only. The coach already knows the lesson is on; the push points them
 * at the briefing. The parent/athlete side is a separate nudge three days
 * after the lesson (`practice-nudges.server.ts`).
 *
 * "Now" is fixed to `America/New_York` (no per-coach/per-slot timezone
 * exists in the schema).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import { notifyUsers, type PushDeps } from "./push-notify.server";
// RINK_TZ is the one timezone constant this project already has; reused here
// rather than re-declared, per the ijs-scrape.server.ts precedent.
import { RINK_TZ } from "./ijs-scrape.server";
import {
  addDays,
  expandSlotOccurrences,
  parseIsoDate,
  toIsoDate,
  type LessonFrequency,
} from "./lesson-recurrence";

type Client = SupabaseClient<Database>;

export type LessonReminderContext = { admin: Client; push?: PushDeps };

/** `wouldSend` = occurrences handled this tick (kept for the hook's response shape); `sent` = pushes APNs accepted. */
export type LessonReminderResult = { scanned: number; wouldSend: number; sent: number };

/**
 * Occurrences land in this window (minutes from "now") to trigger a reminder.
 * The 5-minute tick first matches at most 15 minutes out, so a 16:00 lesson
 * pushes at 15:45; the 10-minutes-out tick is there to retry a transient failure.
 */
const WINDOW_MIN = 10;
const WINDOW_MAX = 15;

type SlotRow = {
  id: string;
  coach_id: string | null;
  athlete_id: string;
  day_of_week: number;
  start_minute: number;
  end_minute: number;
  frequency: string;
  weeks_of_month: number[];
  starts_on: string | null;
};

type OverrideRow = {
  slot_id: string;
  occurrence_date: string;
  status: string;
  start_minute: number | null;
  end_minute: number | null;
};

type CandidateOccurrence = {
  slotId: string;
  coachId: string;
  athleteId: string;
  lessonDate: string;
};

/** One calendar day's worth of candidate slots, with "now" expressed relative
 * to that day's midnight (negative for a day queried as "tomorrow" from
 * today's clock) so the same startMinute-minus-now window math applies
 * unchanged in both cases. */
type Bucket = { slots: SlotRow[]; dateIso: string; effectiveNowMinutes: number };

/** The wall-clock "now" in RINK_TZ, as a calendar date + minutes-since-midnight + day-of-week. */
export function nowInRinkTz(now: Date): { dateIso: string; minutes: number; dayOfWeek: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: RINK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const dateIso = `${get("year")}-${String(get("month")).padStart(2, "0")}-${String(
    get("day"),
  ).padStart(2, "0")}`;
  // formatToParts with hour12:false can render midnight as "24" in some
  // engines; normalize the same way ijs-scrape.server.ts does.
  const hour = get("hour") % 24;
  const minutes = hour * 60 + get("minute");
  // day-of-week from the plain calendar date, not from `now` itself — a
  // timezone-independent way to get 0=Sun..6=Sat for the RINK_TZ date.
  const dayOfWeek = parseIsoDate(dateIso).getDay();
  return { dateIso, minutes, dayOfWeek };
}

/**
 * `{ gradus: { type, route, v } }` — Roster with this athlete's Up next briefing
 * open (older iOS builds read `roster/briefing/...` as plain Roster).
 */
function reminderPayload(athleteId: string) {
  return {
    gradus: {
      type: "lesson_reminder" as const,
      route: `coach/roster/briefing/${athleteId}`,
      v: 1 as const,
    },
  };
}

/**
 * Slots on the right weekday for `bucket.dateIso` aren't necessarily active
 * on that date — biweekly / monthly / twice-monthly slots only land on some
 * of their weekday's dates — and a slot may be canceled/rescheduled by an
 * override. Resolve both, then keep whatever lands in the reminder window.
 */
async function candidatesForBucket(admin: Client, bucket: Bucket): Promise<CandidateOccurrence[]> {
  const activeSlots = bucket.slots.filter((s) => {
    const occurrences = expandSlotOccurrences(
      {
        dayOfWeek: s.day_of_week,
        frequency: (s.frequency as LessonFrequency) || "weekly",
        weeksOfMonth: s.weeks_of_month,
        startsOn: s.starts_on,
      },
      bucket.dateIso,
      bucket.dateIso,
    );
    return occurrences.length > 0;
  });
  if (activeSlots.length === 0) return [];

  const slotIds = activeSlots.map((s) => s.id);
  const overridesRes = await admin
    .from("lesson_slot_overrides")
    .select("slot_id, occurrence_date, status, start_minute, end_minute")
    .in("slot_id", slotIds)
    .eq("occurrence_date", bucket.dateIso);
  if (overridesRes.error) dbError(overridesRes.error);

  const overrideBySlot = new Map<string, OverrideRow>();
  for (const o of (overridesRes.data ?? []) as unknown as OverrideRow[]) {
    overrideBySlot.set(o.slot_id, o);
  }

  const candidates: CandidateOccurrence[] = [];
  for (const s of activeSlots) {
    const override = overrideBySlot.get(s.id);
    if (override?.status === "canceled") continue;
    const startMinute =
      override?.status === "rescheduled" && override.start_minute != null
        ? override.start_minute
        : s.start_minute;
    const minutesOut = startMinute - bucket.effectiveNowMinutes;
    if (minutesOut < WINDOW_MIN || minutesOut > WINDOW_MAX) continue;
    // A coach unlinked from the athlete's roster keeps the slot with a null
    // coach_id (coach-roster.server.ts); nobody is up next for anyone then.
    if (!s.coach_id) continue;
    candidates.push({
      slotId: s.id,
      coachId: s.coach_id,
      athleteId: s.athlete_id,
      lessonDate: bucket.dateIso,
    });
  }
  return candidates;
}

/**
 * Compute this tick's lesson-reminder occurrences, dedupe against
 * `lesson_reminders_sent`, and push each coach.
 */
export async function computeLessonReminders(
  ctx: LessonReminderContext,
  now: Date = new Date(),
): Promise<LessonReminderResult> {
  const { admin } = ctx;
  const { dateIso, minutes: nowMinutes, dayOfWeek } = nowInRinkTz(now);

  const slotColumns =
    "id, coach_id, athlete_id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on";

  const slotsRes = await admin
    .from("athlete_lesson_slots")
    .select(slotColumns)
    .eq("day_of_week", dayOfWeek);
  if (slotsRes.error) dbError(slotsRes.error);

  const buckets: Bucket[] = [
    {
      slots: (slotsRes.data ?? []) as unknown as SlotRow[],
      dateIso,
      effectiveNowMinutes: nowMinutes,
    },
  ];

  // A lesson starting shortly after midnight belongs to TOMORROW's
  // day_of_week and date, but its reminder window (10-15 minutes out) can
  // only ever be reached from TODAY's clock, in the WINDOW_MAX minutes
  // right before midnight. Whenever we're that close, also fetch tomorrow's
  // slots and treat "now" as negative minutes-into-tomorrow, so the same
  // startMinute-minus-now window check works unchanged for both buckets.
  if (nowMinutes >= 1440 - WINDOW_MAX) {
    const tomorrowDayOfWeek = (dayOfWeek + 1) % 7;
    const tomorrowDateIso = toIsoDate(addDays(parseIsoDate(dateIso), 1));
    const tomorrowSlotsRes = await admin
      .from("athlete_lesson_slots")
      .select(slotColumns)
      .eq("day_of_week", tomorrowDayOfWeek);
    if (tomorrowSlotsRes.error) dbError(tomorrowSlotsRes.error);
    buckets.push({
      slots: (tomorrowSlotsRes.data ?? []) as unknown as SlotRow[],
      dateIso: tomorrowDateIso,
      effectiveNowMinutes: nowMinutes - 1440,
    });
  }

  const candidateLists = await Promise.all(buckets.map((b) => candidatesForBucket(admin, b)));
  const candidates = candidateLists.flat();

  const scanned = candidates.length;
  if (scanned === 0) return { scanned: 0, wouldSend: 0, sent: 0 };

  // Candidates can span two different lesson dates (today and, near
  // midnight, tomorrow), so dedupe on the (slot_id, lesson_date) pair rather
  // than filtering the query to a single date.
  const alreadySentRes = await admin
    .from("lesson_reminders_sent")
    .select("slot_id, lesson_date")
    .in(
      "slot_id",
      candidates.map((c) => c.slotId),
    );
  if (alreadySentRes.error) dbError(alreadySentRes.error);
  const alreadySent = new Set(
    ((alreadySentRes.data ?? []) as { slot_id: string; lesson_date: string }[]).map(
      (r) => `${r.slot_id}|${r.lesson_date}`,
    ),
  );

  const toProcess = candidates.filter((c) => !alreadySent.has(`${c.slotId}|${c.lessonDate}`));
  if (toProcess.length === 0) return { scanned, wouldSend: 0, sent: 0 };

  // Resolve the coach's own user_id and the athlete's first name for the title.
  const coachIds = Array.from(new Set(toProcess.map((c) => c.coachId)));
  const athleteIds = Array.from(new Set(toProcess.map((c) => c.athleteId)));

  const [coachesRes, athletesRes] = await Promise.all([
    admin.from("coach_profiles").select("id, user_id").in("id", coachIds),
    admin.from("athletes").select("id, first_name").in("id", athleteIds),
  ]);
  if (coachesRes.error) dbError(coachesRes.error);
  if (athletesRes.error) dbError(athletesRes.error);

  const coachUserById = new Map<string, string | null>();
  for (const c of (coachesRes.data ?? []) as { id: string; user_id: string | null }[]) {
    coachUserById.set(c.id, c.user_id);
  }
  const firstNameById = new Map<string, string>();
  for (const a of (athletesRes.data ?? []) as { id: string; first_name: string | null }[]) {
    if (a.first_name?.trim()) firstNameById.set(a.id, a.first_name.trim());
  }

  const allUserIds = Array.from(
    new Set(
      toProcess.map((c) => coachUserById.get(c.coachId) ?? null).filter((id): id is string => !!id),
    ),
  );

  const tokensByUser = new Map<string, { token: string; platform: string }[]>();
  if (allUserIds.length > 0) {
    const tokensRes = await admin
      .from("device_tokens")
      .select("user_id, token, platform")
      .in("user_id", allUserIds);
    if (tokensRes.error) dbError(tokensRes.error);
    for (const t of (tokensRes.data ?? []) as {
      user_id: string;
      token: string;
      platform: string;
    }[]) {
      const arr = tokensByUser.get(t.user_id) ?? [];
      arr.push({ token: t.token, platform: t.platform });
      tokensByUser.set(t.user_id, arr);
    }
  }

  const nowIso = now.toISOString();
  const rows = toProcess.map((c) => ({
    slot_id: c.slotId,
    athlete_id: c.athleteId,
    coach_id: c.coachId,
    lesson_date: c.lessonDate,
    sent_at: nowIso,
  }));

  // Upsert is the dedupe boundary against a concurrent tick: ignoreDuplicates
  // turns a UNIQUE(slot_id, lesson_date) conflict into a no-op (no thrown
  // error, no returned row) instead of a failed insert. Only rows that were
  // actually newly inserted come back, so `inserted` is the true "handled
  // just now" set even under a race with another invocation.
  const upsertRes = await admin
    .from("lesson_reminders_sent")
    .upsert(rows, { onConflict: "slot_id,lesson_date", ignoreDuplicates: true })
    .select("slot_id, lesson_date");
  if (upsertRes.error && (upsertRes.error as { code?: string }).code !== "23505") {
    dbError(upsertRes.error);
  }
  // Keyed on the (slot_id, lesson_date) pair, not slot_id alone — a slot can
  // only land in one bucket per tick (today or tomorrow, never both, since
  // the two buckets query disjoint day_of_week values), but keying on the
  // pair keeps this correct rather than relying on that invariant.
  const insertedKeys = new Set(
    ((upsertRes.data ?? []) as { slot_id: string; lesson_date: string }[]).map(
      (r) => `${r.slot_id}|${r.lesson_date}`,
    ),
  );

  let wouldSend = 0;
  let sent = 0;
  for (const c of toProcess) {
    // lost a race with another tick; already handled
    if (!insertedKeys.has(`${c.slotId}|${c.lessonDate}`)) continue;
    wouldSend += 1;

    const coachUserId = coachUserById.get(c.coachId) ?? null;
    const coachTokens = coachUserId ? (tokensByUser.get(coachUserId) ?? []) : [];
    const coachPayload = reminderPayload(c.athleteId);
    const firstName = firstNameById.get(c.athleteId);

    console.log(
      "[api] lesson-reminders sending",
      JSON.stringify({
        slotId: c.slotId,
        athleteId: c.athleteId,
        coachId: c.coachId,
        lessonDate: c.lessonDate,
        coach: { userId: coachUserId, tokenCount: coachTokens.length, payload: coachPayload },
      }),
    );

    // Real delivery (PRD §6.6 "Lesson reminders"). `notifyUsers` resolves tokens
    // itself; the maps above stay for the log line and the existing tests.
    const collapse = `lesson:${c.slotId}:${c.lessonDate}`;
    // The reminder is only useful before the lesson; stop retrying at its start.
    const expiresInSeconds = WINDOW_MAX * 60;
    let occurrenceSent = 0;
    let transientFailures = 0;
    // No token-count gate: `notifyUsers` records the inbox row even for a coach
    // with push off, and skips APNs itself when there is no device.
    if (coachUserId) {
      const r = await notifyUsers(
        admin,
        [coachUserId],
        {
          type: coachPayload.gradus.type,
          route: coachPayload.gradus.route,
          title: firstName ? `${firstName} is up next` : "Your next lesson is up",
          body: "See what they've been practicing since you last coached them.",
          collapseId: `${collapse}:coach`,
          expiresInSeconds,
          athleteId: c.athleteId,
        },
        ctx.push,
      );
      occurrenceSent += r.sent;
      transientFailures += r.failed - r.pruned;
    }
    sent += occurrenceSent;
    // Nothing got through and at least one failure was transient (APNs outage,
    // timeout): release the dedupe row so the next tick inside the window retries.
    if (occurrenceSent === 0 && transientFailures > 0) {
      await admin
        .from("lesson_reminders_sent")
        .delete()
        .eq("slot_id", c.slotId)
        .eq("lesson_date", c.lessonDate);
    }
  }

  return { scanned, wouldSend, sent };
}
