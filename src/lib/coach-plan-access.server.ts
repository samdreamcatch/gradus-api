/**
 * Who may read another coach's plans for a shared athlete (Mariah, 2026-09-27):
 *
 *   - A Club coach reads every other coach's plans on athletes they share.
 *   - Any other coach (Pro included) needs a live visibility link with that
 *     coach for this athlete: both coaches accepted it, the parent's opt-in
 *     for both is still on, and it is still covered — the athlete's Team plan
 *     is live, or either coach in the pair is on Pro or Club. A lapsed Team
 *     plan locks a link between two Coach-tier coaches; it doesn't delete it.
 *
 * Single source of truth for the athlete-detail payload and the read-only
 * plan view opened from a message thread. The SQL mirror is
 * `public.coaches_linked_for_athlete` (RLS on plans / plan_moves /
 * plan_sessions / goals / schedule) — keep the two in step.
 */
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dbError } from "./db-error";
import { teamPlanActive } from "./team.server";

type Admin = typeof supabaseAdmin;

export type VisibilityLinkState = "pending" | "declined" | "accepted";

export interface OtherCoachPlanAccess {
  /** The viewer is on Club — every other coach on the athlete is readable. */
  viewerIsClub: boolean;
  /** Other coaches unlocked for this viewer by a live visibility link. */
  linkedCoachIds: string[];
  /**
   * Where each link stands. An accepted link that is no longer live (opt-in
   * off, or Team plan lapsed with no Pro/Club coach in the pair) is left out,
   * so the clients show it as "not connected" rather than "Accepted".
   */
  linkStates: Record<string, VisibilityLinkState>;
}

const PAID_COACH_TIERS = new Set(["coach_pro", "club"]);

async function effectiveTier(admin: Admin, coachId: string): Promise<string> {
  const { data, error } = await admin.rpc("coach_effective_tier", { _coach_id: coachId });
  if (error) dbError(error);
  return (data as string | null) ?? "coach";
}

/** True when any guardian of the athlete (primary or co-guardian) has a live Team plan. */
async function athleteTeamPlanActive(admin: Admin, athleteId: string): Promise<boolean> {
  const [athleteRes, guardiansRes] = await Promise.all([
    admin.from("athletes").select("parent_id").eq("id", athleteId).maybeSingle(),
    admin.from("athlete_guardians").select("parent_id").eq("athlete_id", athleteId),
  ]);
  if (athleteRes.error) dbError(athleteRes.error);
  if (guardiansRes.error) dbError(guardiansRes.error);
  const parentIds = new Set<string>();
  const primary = (athleteRes.data as { parent_id: string | null } | null)?.parent_id;
  if (primary) parentIds.add(primary);
  for (const g of guardiansRes.data ?? []) parentIds.add(g.parent_id as string);
  for (const id of parentIds) {
    if (await teamPlanActive(admin, id)) return true;
  }
  return false;
}

export async function otherCoachPlanAccess(
  admin: Admin,
  viewerCoachId: string,
  athleteId: string,
  otherCoachIds: string[],
): Promise<OtherCoachPlanAccess> {
  const viewerTier = await effectiveTier(admin, viewerCoachId);
  const access: OtherCoachPlanAccess = {
    viewerIsClub: viewerTier === "club",
    linkedCoachIds: [],
    linkStates: {},
  };
  if (otherCoachIds.length === 0) return access;

  const linksRes = await admin
    .from("coach_visibility_links")
    .select("coach_a_id, coach_b_id, a_status, b_status")
    .eq("athlete_id", athleteId)
    .or(`coach_a_id.eq.${viewerCoachId},coach_b_id.eq.${viewerCoachId}`);
  if (linksRes.error) dbError(linksRes.error);
  const links = (linksRes.data ?? []) as {
    coach_a_id: string;
    coach_b_id: string;
    a_status: string;
    b_status: string;
  }[];

  const accepted: string[] = [];
  for (const l of links) {
    const other = l.coach_a_id === viewerCoachId ? l.coach_b_id : l.coach_a_id;
    if (!otherCoachIds.includes(other)) continue;
    if (l.a_status === "declined" || l.b_status === "declined") {
      access.linkStates[other] = "declined";
    } else if (l.a_status === "accepted" && l.b_status === "accepted") {
      accepted.push(other);
    } else {
      access.linkStates[other] = "pending";
    }
  }
  if (accepted.length === 0) return access;

  // The parent's opt-in must still be on for both coaches.
  const optInsRes = await admin
    .from("athlete_coach_visibility")
    .select("coach_id")
    .eq("athlete_id", athleteId)
    .in("coach_id", [viewerCoachId, ...accepted]);
  if (optInsRes.error) dbError(optInsRes.error);
  const optedIn = new Set((optInsRes.data ?? []).map((r) => r.coach_id as string));
  if (!optedIn.has(viewerCoachId)) return access;

  // Coverage: the Team plan, else a Pro or Club coach in the pair.
  const viewerPaid = PAID_COACH_TIERS.has(viewerTier);
  const teamActive = viewerPaid ? true : await athleteTeamPlanActive(admin, athleteId);
  for (const other of accepted) {
    if (!optedIn.has(other)) continue;
    const covered =
      viewerPaid || teamActive || PAID_COACH_TIERS.has(await effectiveTier(admin, other));
    if (!covered) continue;
    access.linkStates[other] = "accepted";
    access.linkedCoachIds.push(other);
  }
  return access;
}

/** True when the viewer may read `ownerCoachId`'s plans for this athlete. */
export function canReadOtherCoachPlans(access: OtherCoachPlanAccess, ownerCoachId: string) {
  return access.viewerIsClub || access.linkedCoachIds.includes(ownerCoachId);
}
