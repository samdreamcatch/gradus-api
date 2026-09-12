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
export const getCoachChecklist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CoachChecklist> => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    const coach = await admin
      .from("coach_profiles")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (coach.error) throw new Error(coach.error.message);
    const coachId = coach.data?.id ?? null;
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
      admin.from("athlete_lesson_slots").select("id").eq("coach_id", coachId).limit(1),
      admin
        .from("coach_athletes")
        .select("athlete_id, athletes!inner(user_id, parent_id, guardian_invited_at)")
        .eq("coach_id", coachId)
        .limit(200),
      admin.from("plans").select("id").eq("coach_id", coachId).limit(1),
    ]);
    if (slots.error) throw new Error(slots.error.message);
    if (links.error) throw new Error(links.error.message);
    if (plans.error) throw new Error(plans.error.message);

    const rows = links.data ?? [];
    const inviteDone = rows.some((r) => {
      const a = r.athletes as unknown as {
        user_id: string | null;
        parent_id: string | null;
        guardian_invited_at: string | null;
      } | null;
      return Boolean(a && (a.user_id || a.parent_id || a.guardian_invited_at));
    });

    const scheduleDone = (slots.data?.length ?? 0) > 0;

    return {
      coachId,
      scheduleDone,
      // If the coach already has lessons before doing anything else, they came
      // in through a connected parent or adult athlete.
      scheduleFromFamilies: scheduleDone && inviteDone,
      inviteDone,
      planDone: (plans.data?.length ?? 0) > 0,
    };
  });
