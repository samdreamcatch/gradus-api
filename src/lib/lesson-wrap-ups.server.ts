/**
 * Lesson wrap-ups (PRD §7.2 "Lesson wrap-ups"): after a slot ends, the
 * coach is asked once per athlete per day to edit, redeploy, or dismiss.
 * Single source of truth for lesson-wrap-ups.functions.ts and
 * `GET /api/v1/coach/wrap-ups/pending` + `POST /api/v1/coach/wrap-ups`.
 * Reads and writes go through the caller's RLS client, as on the web.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { getCoachLessonsOn } from "./coach-day-lessons.server";
import { dbError } from "./db-error";

export type WrapUpClient = SupabaseClient<Database>;

export type WrapUpContext = { userId: string; supabase: WrapUpClient };

export async function getCoachIdOrNull(
  supabase: WrapUpClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  return data?.id ?? null;
}

export type PendingWrapUp = {
  athleteId: string;
  athleteName: string;
  lessonDate: string; // YYYY-MM-DD
  lessonEndMinute: number;
  activePlanId: string | null;
  /**
   * Set when the lesson was a group lesson (PRD §6.16 F): pending wrap-ups that
   * share it are one prompt on the client. Absent for a private lesson.
   */
  groupId?: string;
};

export type WrapUpAction = "edited" | "redeployed" | "dismissed" | "did_not_happen";

/** The client's local "now", since slots are wall-clock times in the coach's day. */
export const pendingWrapUpsInput = z.object({
  lessonDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  currentMinute: z.coerce.number().int().min(0).max(1439),
});

/**
 * `getPendingLessonWrapUps`: today's ended lessons not yet wrapped up, latest
 * first. "Today's lessons" is the same day view "up next" reads: a slot off its
 * biweekly / monthly week or canceled for today is not pending, and a
 * rescheduled one ends at its new time.
 */
export async function getPendingLessonWrapUps(
  ctx: WrapUpContext,
  data: z.infer<typeof pendingWrapUpsInput>,
): Promise<PendingWrapUp[]> {
  const { supabase, userId } = ctx;
  const coachId = await getCoachIdOrNull(supabase, userId);
  if (!coachId) return [];

  // Today's lessons as they actually happen (recurrence and overrides resolved)
  // that have already ended, by their effective end time.
  const ended = (await getCoachLessonsOn(supabase, coachId, data)).filter(
    (l) => l.endMinute <= data.currentMinute,
  );
  if (ended.length === 0) return [];

  const athleteIds = Array.from(new Set(ended.map((l) => l.athleteId)));

  const [handledRes, plansRes, athletesRes] = await Promise.all([
    supabase
      .from("lesson_wrap_ups")
      .select("athlete_id")
      .eq("coach_id", coachId)
      .eq("lesson_date", data.lessonDate)
      .in("athlete_id", athleteIds),
    supabase
      .from("plans")
      .select("id, athlete_id")
      .eq("coach_id", coachId)
      .eq("kind", "plan")
      .eq("status", "active")
      .in("athlete_id", athleteIds),
    supabase.from("athletes").select("id, first_name, last_name").in("id", athleteIds),
  ]);
  if (handledRes.error) dbError(handledRes.error);
  if (plansRes.error) dbError(plansRes.error);
  if (athletesRes.error) dbError(athletesRes.error);

  const handled = new Set((handledRes.data ?? []).map((r) => r.athlete_id as string));
  const activePlanByAthlete = new Map<string, string>();
  for (const p of plansRes.data ?? []) {
    if (!activePlanByAthlete.has(p.athlete_id as string)) {
      activePlanByAthlete.set(p.athlete_id as string, p.id as string);
    }
  }
  const athleteById = new Map<string, { first_name: string; last_name: string }>();
  for (const a of athletesRes.data ?? []) {
    athleteById.set(a.id as string, {
      first_name: a.first_name as string,
      last_name: a.last_name as string,
    });
  }

  // Keep only the latest-ending lesson per athlete that isn't handled yet.
  const byAthlete = new Map<string, PendingWrapUp>();
  for (const { athleteId, endMinute, groupId } of ended) {
    if (handled.has(athleteId)) continue;
    const a = athleteById.get(athleteId);
    if (!a) continue;
    const existing = byAthlete.get(athleteId);
    if (!existing || endMinute > existing.lessonEndMinute) {
      byAthlete.set(athleteId, {
        athleteId,
        athleteName: `${a.first_name} ${a.last_name}`.trim(),
        lessonDate: data.lessonDate,
        lessonEndMinute: endMinute,
        activePlanId: activePlanByAthlete.get(athleteId) ?? null,
        ...(groupId ? { groupId } : {}),
      });
    }
  }

  return Array.from(byAthlete.values()).sort((a, b) => b.lessonEndMinute - a.lessonEndMinute);
}

export const recordWrapUpInput = z.object({
  athleteId: z.string().uuid(),
  lessonDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  action: z.enum(["edited", "redeployed", "dismissed", "did_not_happen"]),
});

const NOT_ON_ROSTER = "Athlete is not on your roster";

/**
 * The caller must coach this athlete. Mirrors the roster clause of the
 * lesson_wrap_ups insert and update policies (read through the same RLS client,
 * so the two cannot disagree). One answer for "not on your roster" and "no such
 * athlete", so athlete ids cannot be probed.
 */
async function assertAthleteOnRoster(supabase: WrapUpClient, coachId: string, athleteId: string) {
  const { data, error } = await supabase
    .from("coach_athletes")
    .select("athlete_id")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) {
    throw new ApiError({ code: "forbidden", status: 403, message: NOT_ON_ROSTER });
  }
}

/** `recordLessonWrapUp`: one row per (coach, athlete, date); a repeat replaces the action. */
export async function recordLessonWrapUp(
  ctx: WrapUpContext,
  data: z.infer<typeof recordWrapUpInput>,
): Promise<{ ok: true }> {
  const { supabase, userId } = ctx;
  const coachId = await getCoachIdOrNull(supabase, userId);
  if (!coachId) throw new ApiError({ code: "wrong_role", status: 403, message: "Not a coach" });
  await assertAthleteOnRoster(supabase, coachId, data.athleteId);

  const { error } = await supabase.from("lesson_wrap_ups").upsert(
    {
      coach_id: coachId,
      athlete_id: data.athleteId,
      lesson_date: data.lessonDate,
      action: data.action,
    },
    { onConflict: "coach_id,athlete_id,lesson_date" },
  );
  // The write is scoped to the caller's own coach_id, so the roster clause is the
  // only one that can fail with 42501.
  if (error?.code === "42501") {
    throw new ApiError({ code: "forbidden", status: 403, message: NOT_ON_ROSTER });
  }
  if (error) dbError(error);
  return { ok: true as const };
}
