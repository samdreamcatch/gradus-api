/**
 * "Up next" for the coach's wrist (PRD §6.15, §10.11 W2, decision #36): a
 * compact list of today's lessons that have not ended, soonest first, so the
 * watch never pulls the whole roster. Each row says whether a pre-lesson
 * briefing is already cached, so the watch knows a tap will speak at once
 * rather than wait on the AI. The briefing itself is
 * `GET /api/v1/coach/athletes/{id}/briefing`, spoken on tap only (#36).
 *
 * Slots are wall-clock times in the coach's day, so the client sends its own
 * local `lessonDate`, `dayOfWeek` and `currentMinute` (the shape
 * `GET /coach/wrap-ups/pending` already uses). Recurrence and per-date
 * overrides (canceled, rescheduled) are resolved by `getCoachLessonsOn`, the
 * same day view pending wrap-ups read, so a lesson leaves "up next" exactly
 * when it starts asking for a wrap-up.
 */
import { z } from "zod";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getCoachLessonsOn } from "./coach-day-lessons.server";
import { dbError } from "./db-error";

type Admin = typeof supabaseAdmin;

export type UpNextContext = { userId: string; admin: Admin };

export const upNextInput = z.object({
  lessonDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  currentMinute: z.coerce.number().int().min(0).max(1439),
  /** At most this many lessons (default 3: the wrist shows a short list). */
  limit: z.coerce.number().int().min(1).max(10).optional(),
});

export type UpNextLesson = {
  slotId: string;
  athleteId: string;
  athleteName: string;
  athleteFirstName: string;
  lessonDate: string; // YYYY-MM-DD
  startMinute: number;
  endMinute: number;
  /** Minutes until the lesson starts; negative once it has started. */
  minutesUntilStart: number;
  inProgress: boolean;
  /**
   * A briefing row exists for this athlete and date. The briefing call may
   * still regenerate it if its inputs changed since; a cached one is the fast case.
   */
  briefingCached: boolean;
  activePlanId: string | null;
};

const DEFAULT_LIMIT = 3;

/** `getUpNext`: the coach's lessons today that have not ended, soonest first. */
export async function getUpNext(
  ctx: UpNextContext,
  data: z.infer<typeof upNextInput>,
): Promise<UpNextLesson[]> {
  const { admin, userId } = ctx;
  const coach = await admin.from("coach_profiles").select("id").eq("user_id", userId).maybeSingle();
  if (coach.error) dbError(coach.error);
  const coachId = coach.data?.id as string | undefined;
  if (!coachId) return [];

  const upcoming = (await getCoachLessonsOn(admin, coachId, data))
    .filter((l) => l.endMinute > data.currentMinute) // ended ones are the wrap-up's job
    .sort((a, b) => a.startMinute - b.startMinute)
    .slice(0, data.limit ?? DEFAULT_LIMIT);
  if (upcoming.length === 0) return [];

  const athleteIds = Array.from(new Set(upcoming.map((u) => u.athleteId)));
  const [athletesRes, plansRes, briefingsRes] = await Promise.all([
    admin.from("athletes").select("id, first_name, last_name").in("id", athleteIds),
    admin
      .from("plans")
      .select("id, athlete_id")
      .eq("coach_id", coachId)
      .eq("kind", "plan")
      .eq("status", "active")
      .in("athlete_id", athleteIds),
    admin
      .from("pre_lesson_briefings")
      .select("athlete_id")
      .eq("coach_id", coachId)
      .eq("lesson_date", data.lessonDate)
      .in("athlete_id", athleteIds),
  ]);
  if (athletesRes.error) dbError(athletesRes.error);
  if (plansRes.error) dbError(plansRes.error);
  if (briefingsRes.error) dbError(briefingsRes.error);

  const names = new Map<string, { first: string; last: string }>();
  for (const a of athletesRes.data ?? []) {
    names.set(a.id as string, { first: a.first_name as string, last: a.last_name as string });
  }
  const planByAthlete = new Map<string, string>();
  for (const p of plansRes.data ?? []) {
    if (!planByAthlete.has(p.athlete_id as string)) {
      planByAthlete.set(p.athlete_id as string, p.id as string);
    }
  }
  const cached = new Set((briefingsRes.data ?? []).map((b) => b.athlete_id as string));

  return upcoming.flatMap(({ slotId, athleteId, startMinute, endMinute }) => {
    const name = names.get(athleteId);
    if (!name) return []; // an athlete the coach can no longer see
    return [
      {
        slotId,
        athleteId,
        athleteName: `${name.first} ${name.last}`.trim(),
        athleteFirstName: name.first,
        lessonDate: data.lessonDate,
        startMinute,
        endMinute,
        minutesUntilStart: startMinute - data.currentMinute,
        inProgress: startMinute <= data.currentMinute,
        briefingCached: cached.has(athleteId),
        activePlanId: planByAthlete.get(athleteId) ?? null,
      },
    ];
  });
}
