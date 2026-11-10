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
import { getPlanMarketplaceFields } from "./plan-marketplace-fields.server";
import { getAthletePlan } from "./athlete-plans.server";
import { ATHLETE_SOURCE, getAuthoredPlanDetail } from "./athlete-authoring.server";
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
  /**
   * `plans.source`, set when the plan was written by an athlete (`"athlete"`);
   * omitted otherwise. Optional on the wire so an installed client never
   * fails to decode a response from a server that predates it.
   */
  source?: string;
  /** The athlete author's first name, with `source: "athlete"` ("By Greta"). */
  authorFirstName?: string | null;
  /** "plan" or "moves": what the athlete rates after practice. Optional on the wire. */
  feedbackScope?: string;
  /** Marketplace price in USD (0 is free); in the coach's view only. Optional on the wire. */
  price?: number;
  /** The plan's image URL (plan-marketplace-fields.server.ts); for the owning coach only. */
  media?: string | null;
  /** "plan" or "program"; null on plans made before it existed. In the coach's view only. */
  productType?: "plan" | "program" | null;
  /** The level the plan is for; null on older plans. In the coach's view only. */
  selectedLevel?: string | null;
  /** The other end of a level range; null for a single level. In the coach's view only. */
  selectedLevelTo?: string | null;
  /** Marketplace description; in the coach's view only. */
  description?: string | null;
  /** Weeks it runs, sessions per week, and a Program's lessons; null when unset. In the coach's view only. */
  weeks?: number | null;
  sessionsPerWeek?: number | null;
  lessonCount?: number | null;
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

  // A plan the caller wrote as an athlete (PRD §6.14): served to its author in
  // any status, as theirs. Checked first for an athlete, and for a parent who
  // also has an athlete profile of their own (`resolvePlanViewerRole` says
  // "parent" for them), and as a fallback for a coach who also trains (a
  // coach's own loader would say "not found").
  if (role === "athlete" || role === "parent") {
    const own = await getAuthoredPlanDetail(ctx, id);
    if (own) return own;
  }
  // This route is `/api/v1`: the plans an athlete wrote are in scope for the other loaders too.
  const withAuthored = { ...ctx, includeAuthored: true };

  if (role === "coach") {
    let plan;
    try {
      plan = await getPlan({ userId: ctx.userId, supabase: ctx.supabase }, id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        const own = await getAuthoredPlanDetail(ctx, id);
        if (own) return own;
      }
      throw err;
    }
    const marketplace = await getPlanMarketplaceFields(ctx.supabase, plan.id);
    // A rostered coach reading a plan the athlete wrote (read-only): say so.
    let source: string | undefined;
    let authorFirstName: string | null | undefined;
    if (!plan.isOwner && plan.athleteId) {
      const authored = await ctx.admin
        .from("plans")
        .select("source, athletes:athlete_id(first_name)")
        .eq("id", plan.id)
        .maybeSingle();
      if (authored.error) dbError(authored.error);
      if (authored.data?.source === ATHLETE_SOURCE) {
        source = ATHLETE_SOURCE;
        // The stored first name, never a split of the full name ("Mary Ann" stays whole).
        authorFirstName =
          (authored.data as unknown as { athletes: { first_name: string } | null }).athletes
            ?.first_name ?? null;
      }
    }
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
      feedbackScope: plan.feedbackScope,
      ...(source ? { source, authorFirstName } : {}),
      ...(marketplace
        ? {
            price: marketplace.price,
            productType: marketplace.productType,
            selectedLevel: marketplace.selectedLevel,
            selectedLevelTo: marketplace.selectedLevelTo,
            description: marketplace.description,
            weeks: marketplace.weeks,
            sessionsPerWeek: marketplace.sessionsPerWeek,
            lessonCount: marketplace.lessonCount,
          }
        : {}),
      // Only the owner can load the image (the plan-media storage policies).
      ...(marketplace && plan.isOwner ? { media: marketplace.media } : {}),
    };
  }

  const plan =
    role === "parent"
      ? await getParentPlan(withAuthored, id)
      : await getAthletePlan(withAuthored, id);
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
    // A plan the athlete wrote has no coach: a parent sees it as "By <first name>".
    coach:
      plan.source === ATHLETE_SOURCE
        ? null
        : {
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
    feedbackScope: plan.feedbackScope ?? "plan",
    ...(plan.source === ATHLETE_SOURCE
      ? { source: ATHLETE_SOURCE, authorFirstName: plan.athleteFirstName }
      : {}),
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
