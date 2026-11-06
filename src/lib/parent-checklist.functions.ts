import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  PARENT_VERIFICATION_COLUMNS,
  toParentVerificationDTO,
} from "./guardian-verification.server";

export type ParentChecklist = {
  parentId: string | null;
  /**
   * The adult-verification step is part of this parent's setup: the switch is
   * on, or Kids Web Services is configured so they can verify ahead of the
   * gates (decision #34). Off in environments without KWS, where the step is
   * left out of the list rather than shown as something they cannot do.
   */
  verifyApplies: boolean;
  /** The parent is a verified adult (KWS, admin, or a legacy profile). */
  verifyDone: boolean;
  /** At least one coach is linked to one of the parent's athletes. */
  coachDone: boolean;
  /** How many athletes the parent has added (own athletes, not co-guardian ones). */
  athleteCount: number;
  /** At least one of the parent's athletes has a level and season goal on file. */
  goalsDone: boolean;
};

const EMPTY: ParentChecklist = {
  parentId: null,
  verifyApplies: false,
  verifyDone: false,
  coachDone: false,
  athleteCount: 0,
  goalsDone: false,
};

/**
 * Progress for the parent "Get set up" helper (the parent's counterpart to
 * `computeCoachChecklist`): confirm you're an adult, connect with your
 * coach, add your athlete and set goals together. Derived from real data so
 * a step stays ticked wherever the parent did it — the sign-up wizard, a
 * claim link, Settings, or the coach linking from their side. Shared by the
 * web server function below and `GET /api/v1/parent/checklist` (iOS). Runs
 * on the admin client because the coach links it counts belong to the
 * coach's rows.
 */
export async function computeParentChecklist(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ParentChecklist> {
  const parent = await admin
    .from("parent_profiles")
    .select(`${PARENT_VERIFICATION_COLUMNS}, coach_id`)
    .eq("user_id", userId)
    .maybeSingle();
  if (parent.error) throw new Error(parent.error.message);
  if (!parent.data) return EMPTY;

  const row = parent.data as {
    id: string;
    coach_id: string | null;
    adult_verified_at: string | null;
    adult_verification_method: string | null;
    adult_verification_requested_at: string | null;
  };
  const verification = toParentVerificationDTO(row, env);

  const athletes = await admin.from("athletes").select("id").eq("parent_id", row.id).limit(200);
  if (athletes.error) throw new Error(athletes.error.message);
  const athleteIds = ((athletes.data ?? []) as { id: string }[]).map((a) => a.id);

  let coachDone = Boolean(row.coach_id);
  let goalsDone = false;
  if (athleteIds.length > 0) {
    const [links, goals] = await Promise.all([
      coachDone
        ? Promise.resolve({ data: [], error: null })
        : admin.from("coach_athletes").select("athlete_id").in("athlete_id", athleteIds).limit(1),
      admin.from("athlete_goals").select("athlete_id").in("athlete_id", athleteIds).limit(1),
    ]);
    if (links.error) throw new Error(links.error.message);
    if (goals.error) throw new Error(goals.error.message);
    coachDone = coachDone || ((links.data as unknown[] | null)?.length ?? 0) > 0;
    goalsDone = ((goals.data as unknown[] | null)?.length ?? 0) > 0;
  }

  return {
    parentId: row.id,
    verifyApplies: verification.required || verification.available,
    verifyDone: verification.verified,
    coachDone,
    athleteCount: athleteIds.length,
    goalsDone,
  };
}

/** Which steps the helper lists, in order, and whether each is done. */
export function parentChecklistSteps(
  c: ParentChecklist,
): { key: "verify" | "coach" | "goals"; done: boolean }[] {
  return [
    ...(c.verifyApplies ? [{ key: "verify" as const, done: c.verifyDone }] : []),
    { key: "coach" as const, done: c.coachDone },
    { key: "goals" as const, done: c.goalsDone },
  ];
}

/**
 * Progress for the parent getting-started checklist, derived from real data
 * so a step stays ticked no matter where in the app the parent did it.
 */
export const getParentChecklist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ParentChecklist> => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    return computeParentChecklist(admin, context.userId);
  });
