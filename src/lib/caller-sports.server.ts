/**
 * The sport keys a caller's account touches, for `GET /api/v1/me` (the iOS
 * shell uses it to show the Live board only to accounts with figure skating,
 * the one sport the board serves; TestFlight QA 2026-09-26).
 *
 * Same sources the role's resources feed reads (`coach-resources.server.ts`,
 * `parent-resources.server.ts`, `athlete-resources.server.ts`):
 *   coach   -> coach_levels
 *   parent  -> athlete_goals + coach_athlete_sports for every athlete they
 *              guard (own or co-guardian; locked athletes included, since
 *              this only picks which features to show)
 *   athlete -> athlete_goals + coach_athlete_sports for themself
 * Sorted, de-duplicated. Org admins and profile-less callers get [].
 */
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dbError } from "./db-error";

type Admin = typeof supabaseAdmin;

export type CallerSportsInput =
  | { role: "coach"; coachId: string }
  | { role: "parent"; parentId: string }
  | { role: "athlete"; athleteId: string }
  | { role: "none" };

/** Who a parent guards; injectable so tests need not mock `team.server`. */
type GuardedAthletes = (admin: Admin, parentId: string) => Promise<{ athleteId: string }[]>;

const defaultGuardedAthletes: GuardedAthletes = async (admin, parentId) => {
  const { guardianAthleteAccess } = await import("./team.server");
  return guardianAthleteAccess(admin, parentId);
};

export async function callerSports(
  admin: Admin,
  input: CallerSportsInput,
  guardedAthletes: GuardedAthletes = defaultGuardedAthletes,
): Promise<string[]> {
  if (input.role === "coach") {
    const { data, error } = await admin
      .from("coach_levels")
      .select("sport")
      .eq("coach_id", input.coachId);
    if (error) dbError(error);
    return uniqueSorted((data ?? []).map((r) => r.sport as string));
  }

  let athleteIds: string[] = [];
  if (input.role === "athlete") {
    athleteIds = [input.athleteId];
  } else if (input.role === "parent") {
    athleteIds = (await guardedAthletes(admin, input.parentId)).map((a) => a.athleteId);
  }
  if (!athleteIds.length) return [];

  const [goals, coachSports] = await Promise.all([
    admin.from("athlete_goals").select("sport").in("athlete_id", athleteIds),
    admin.from("coach_athlete_sports").select("sport").in("athlete_id", athleteIds),
  ]);
  if (goals.error) dbError(goals.error);
  if (coachSports.error) dbError(coachSports.error);
  return uniqueSorted([
    ...(goals.data ?? []).map((r) => r.sport as string),
    ...(coachSports.data ?? []).map((r) => r.sport as string),
  ]);
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}
