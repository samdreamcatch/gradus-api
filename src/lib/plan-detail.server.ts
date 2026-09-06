/**
 * The role-aware plan detail behind `GET /api/v1/plans/{id}` (PRD Appendix A
 * "role-aware"): one response shape for coaches, parents, and athletes, so
 * the iOS plan screen renders from a single DTO. The three role-specific
 * loaders keep their own semantics; this module only chooses one and maps.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { SessionsByState } from "@/components/plans/flow-state-bars";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { getAthletePlan } from "./athlete-plans.server";
import { getParentPlan } from "./parent-plans.server";
import { getPlanSessionCounts } from "./plan-sessions.server";
import { getPlan, type PlanKind, type PlanMoveDTO, type PlanStatus } from "./plans.server";

type Client = SupabaseClient<Database>;

export type PlanViewerRole = "coach" | "parent" | "athlete";

export type PlanDetailContext = { userId: string; supabase: Client; admin: Client };

export interface PlanCoachDTO {
  id: string;
  name: string;
  firstName: string;
  isGradus: boolean;
}

export interface RoleAwarePlanDetailDTO {
  id: string;
  title: string;
  notes: string;
  kind: PlanKind;
  status: PlanStatus;
  athleteId: string | null;
  athleteName: string | null;
  athleteFirstName: string | null;
  /** The plan's coach as seen by a parent or athlete; null in the coach's own view. */
  coach: PlanCoachDTO | null;
  viewerRole: PlanViewerRole;
  /** True only for the owning coach: every write route requires it. */
  isOwner: boolean;
  moveCount: number;
  totalMinutes: number;
  updatedAt: string;
  moves: PlanMoveDTO[];
  voiceTranscript: string | null;
  sessionsByState: SessionsByState;
  sessionsTotal: number;
}

/**
 * Which loader serves this caller: an existing coach profile wins, then a
 * parent profile, then an athlete row. A user with none of them is treated
 * as a coach, which is what the web's coach loader does (it creates the
 * profile on first use and refuses parents).
 */
export async function resolvePlanViewerRole(
  supabase: Client,
  userId: string,
): Promise<PlanViewerRole> {
  const coach = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (coach.error) dbError(coach.error);
  if (coach.data) return "coach";

  const parent = await supabase
    .from("parent_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (parent.error) dbError(parent.error);
  if (parent.data) return "parent";

  const athlete = await supabase.from("athletes").select("id").eq("user_id", userId).maybeSingle();
  if (athlete.error) dbError(athlete.error);
  if (athlete.data) return "athlete";

  return "coach";
}

export async function getPlanForViewer(
  ctx: PlanDetailContext,
  id: string,
): Promise<RoleAwarePlanDetailDTO> {
  const role = await resolvePlanViewerRole(ctx.supabase, ctx.userId);

  if (role === "coach") {
    const plan = await getPlan({ userId: ctx.userId, supabase: ctx.supabase }, id);
    return {
      id: plan.id,
      title: plan.title,
      notes: plan.notes,
      kind: plan.kind,
      status: plan.status,
      athleteId: plan.athleteId,
      athleteName: plan.athleteName,
      athleteFirstName: plan.athleteName ? plan.athleteName.split(" ")[0] : null,
      coach: null,
      viewerRole: "coach",
      isOwner: plan.isOwner,
      moveCount: plan.moveCount,
      totalMinutes: plan.totalMinutes,
      updatedAt: plan.updatedAt,
      moves: plan.moves,
      voiceTranscript: plan.voiceTranscript,
      sessionsByState: plan.sessionsByState,
      sessionsTotal: plan.sessionsTotal,
    };
  }

  const plan = role === "parent" ? await getParentPlan(ctx, id) : await getAthletePlan(ctx, id);
  // Parents read counts through RLS; athletes through the admin client, as their list does.
  const sessions = await getPlanSessionCounts(role === "parent" ? ctx.supabase : ctx.admin, id);
  return {
    id: plan.id,
    title: plan.title,
    notes: plan.notes,
    kind: "plan",
    status: plan.status,
    athleteId: plan.athleteId,
    athleteName: null,
    athleteFirstName: plan.athleteFirstName,
    coach: {
      id: plan.coachId,
      name: plan.coachName,
      firstName: plan.coachFirstName,
      isGradus: plan.isGradus,
    },
    viewerRole: role,
    isOwner: false,
    moveCount: plan.moveCount,
    totalMinutes: plan.totalMinutes,
    updatedAt: plan.updatedAt,
    moves: plan.moves.map((m) => ({ ...m, moveId: null, libraryMove: null })),
    voiceTranscript: null,
    sessionsByState: sessions.sessionsByState,
    sessionsTotal: sessions.sessionsTotal,
  };
}

/** Coaches only; used by the write routes so a parent or athlete never reaches a coach loader that would create a profile. */
export function requireCoachViewer(role: PlanViewerRole): void {
  if (role !== "coach") {
    throw new ApiError({ code: "wrong_role", status: 403, message: "Not a coach" });
  }
}

/**
 * For the coach-only plan and library routes: refuses parents and athletes
 * before any coach loader runs (the web's `ensureCoachId` would otherwise
 * create a coach profile for an athlete on first touch), and hands back the
 * context the shared coach modules take.
 */
export async function requirePlansCoach(ctx: {
  userId: string;
  supabase: Client;
}): Promise<{ userId: string; supabase: Client }> {
  requireCoachViewer(await resolvePlanViewerRole(ctx.supabase, ctx.userId));
  return { userId: ctx.userId, supabase: ctx.supabase };
}
