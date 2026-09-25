import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CoachChecklist = {
  coachId: string | null;
  /** Any lesson slot attached to this coach — including ones a parent or adult athlete entered. */
  scheduleDone: boolean;
  /** True when the coach's schedule exists only because a connected family entered it. */
  scheduleFromFamilies: boolean;
  /** At least one rostered athlete has been invited or already has an account. */
  inviteDone: boolean;
  /** The coach has created at least one practice plan. */
  planDone: boolean;
};

/**
 * Progress for the coach getting-started checklist, derived from real data so
 * a step stays ticked no matter where in the app the coach did it.
 */
/**
 * Shared by the web server function below and `GET /api/v1/coach/checklist`
 * (iOS onboarding helpers, PRD §7.2). Runs on the admin client because the
 * slots and links it counts belong to other users' rows.
 */
export async function computeCoachChecklist(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  userId: string,
): Promise<CoachChecklist> {
  const coach = await admin.from("coach_profiles").select("id").eq("user_id", userId).maybeSingle();
  if (coach.error) throw new Error(coach.error.message);
  const coachId = (coach.data?.id as string | undefined) ?? null;
  if (!coachId) {
    return {
      coachId: null,
      scheduleDone: false,
      scheduleFromFamilies: false,
      inviteDone: false,
      planDone: false,
    };
  }

  const [slots, links, plans] = await Promise.all([
    admin.from("athlete_lesson_slots").select("athlete_id").eq("coach_id", coachId).limit(200),
    admin.from("coach_athletes").select("athlete_id").eq("coach_id", coachId).limit(200),
    admin.from("plans").select("id").eq("coach_id", coachId).limit(1),
  ]);
  if (slots.error) throw new Error(slots.error.message);
  if (links.error) throw new Error(links.error.message);
  if (plans.error) throw new Error(plans.error.message);

  type IdRow = { athlete_id: string | null };
  const slotAthleteIds = Array.from(
    new Set(((slots.data ?? []) as IdRow[]).map((r) => r.athlete_id).filter(Boolean) as string[]),
  );
  const rosterAthleteIds = Array.from(
    new Set(((links.data ?? []) as IdRow[]).map((r) => r.athlete_id).filter(Boolean) as string[]),
  );
  const allIds = Array.from(new Set([...slotAthleteIds, ...rosterAthleteIds]));

  let athletes: {
    id: string;
    user_id: string | null;
    parent_id: string | null;
    guardian_invited_at: string | null;
    added_by_coach_id: string | null;
  }[] = [];
  if (allIds.length > 0) {
    const res = await admin
      .from("athletes")
      .select("id, user_id, parent_id, guardian_invited_at, added_by_coach_id")
      .in("id", allIds);
    if (res.error) throw new Error(res.error.message);
    athletes = res.data ?? [];
  }
  const byId = new Map(athletes.map((a) => [a.id, a]));

  const inviteDone = rosterAthleteIds.some((id) => {
    const a = byId.get(id);
    return Boolean(a && (a.user_id || a.parent_id || a.guardian_invited_at));
  });

  const scheduleDone = slotAthleteIds.length > 0;
  // Lessons on athletes this coach never added came from a connected parent
  // or adult athlete entering their own times.
  const scheduleFromFamilies = slotAthleteIds.some(
    (id) => byId.get(id)?.added_by_coach_id !== coachId,
  );

  return {
    coachId,
    scheduleDone,
    scheduleFromFamilies,
    inviteDone,
    planDone: ((plans.data as unknown[] | null)?.length ?? 0) > 0,
  };
}

/**
 * Progress for the coach getting-started checklist, derived from real data so
 * a step stays ticked no matter where in the app the coach did it.
 */
export const getCoachChecklist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CoachChecklist> => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    return computeCoachChecklist(admin, context.userId);
  });
