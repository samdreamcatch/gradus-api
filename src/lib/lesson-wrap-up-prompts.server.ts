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
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
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
};

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

  const slotsRes = await admin
    .from("athlete_lesson_slots")
    .select(
      "id, coach_id, athlete_id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on",
    )
    .eq("day_of_week", dayOfWeek);
  if (slotsRes.error) dbError(slotsRes.error);
  const slots = ((slotsRes.data ?? []) as unknown as SlotRow[]).filter((s) => !!s.coach_id);
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

  const justEnded = active.filter((s) => {
    const override = overrideBySlot.get(s.id);
    if (override?.status === "canceled") return false;
    // The read-time card ignores overrides and shows once the *base* end time
    // has passed, so a lesson rescheduled earlier is prompted at the later of
    // the two; rescheduled later is prompted when it actually ends.
    const overrideEnd =
      override?.status === "rescheduled" && override.end_minute != null
        ? override.end_minute
        : null;
    const endMinute = overrideEnd == null ? s.end_minute : Math.max(s.end_minute, overrideEnd);
    const ago = nowMinutes - endMinute;
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
  const athleteIds = Array.from(new Set(fresh.map((s) => s.athlete_id)));
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
  const athleteNameById = new Map<string, string>();
  for (const a of (athletesRes.data ?? []) as {
    id: string;
    first_name: string | null;
    last_name: string | null;
  }[]) {
    athleteNameById.set(
      a.id,
      `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "Your athlete",
    );
  }

  let sent = 0;
  for (const s of fresh) {
    const coachUser = coachUserById.get(s.coach_id as string) ?? null;
    if (!coachUser) continue;
    const name = athleteNameById.get(s.athlete_id) ?? "Your athlete";
    const report = await notifyUsers(
      admin,
      [coachUser],
      {
        type: "lesson_wrap_up",
        route: "coach/wrap-ups",
        title: "Lesson wrap-up",
        body: `${name}'s lesson just ended. Edit, redeploy, or dismiss their plan.`,
        collapseId: `wrapup:${s.id}:${dateIso}`,
      },
      ctx.push,
    );
    sent += report.sent;
    // Nothing got through and a failure was transient: release the dedupe row so
    // the next tick inside the window retries.
    if (report.sent === 0 && report.failed - report.pruned > 0) {
      await bookkeeping
        .from("lesson_wrap_up_prompts_sent")
        .delete()
        .eq("slot_id", s.id)
        .eq("lesson_date", dateIso);
    }
  }

  return { scanned, prompted: fresh.length, sent };
}
