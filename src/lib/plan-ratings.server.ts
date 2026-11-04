/**
 * Plan ratings (migration 20261106120000_plan_ratings): 1–5 stars and an
 * optional review, one per person per plan, and an optional reply from the
 * plan's coach.
 *
 * Who may rate is the database's rule, `public.can_rate_plan()`: the athlete
 * the plan is assigned to and that athlete's parents or guardians, once the
 * plan is shared with them (active or benched). Writes go through the
 * caller's RLS client, so the policies and column guards apply; this module
 * checks the same rule first only to answer with a clear 403.
 *
 * Reviews are read through the service role, for anyone who can see the plan
 * or finds it in the marketplace, and carry the reviewer's first name and last
 * initial only.
 *
 * `plan_ratings`, `plans.rating_avg/rating_count` and the helper functions
 * aren't in the generated types until Lovable regenerates them, so they go
 * through `untyped`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

type Untyped = {
  from: (table: string) => any;
  rpc: (fn: "can_rate_plan" | "is_plan_coach", args: { _plan_id: string }) => any;
};
const untyped = (client: Client) => client as unknown as Untyped;

export type PlanRatingsContext = { userId: string; supabase: Client; admin: Client };

const forbidden = (message: string) => new ApiError({ code: "forbidden", status: 403, message });
const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });

export const ratePlanInput = z.object({
  rating: z.number().int().min(1).max(5),
  /** Optional written review; null or absent leaves none. */
  review: z.string().trim().max(2000).nullable().optional(),
});

export const respondToRatingInput = z.object({
  /** The coach's reply; null removes it. */
  response: z.string().trim().min(1).max(2000).nullable(),
});

export const listPlanRatingsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

export type PlanRatingSummary = { average: number | null; count: number };

export interface PlanRatingDTO {
  id: string;
  rating: number;
  review: string | null;
  /** First name and last initial ("Greta S."), and whether they rated as the athlete or a parent. */
  reviewer: { name: string; role: "athlete" | "parent" };
  coachResponse: string | null;
  coachRespondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanRatingsPageDTO {
  summary: PlanRatingSummary;
  /** The caller's own rating on this plan, if any. */
  myRating: PlanRatingDTO | null;
  /** Whether the caller may rate (or re-rate) this plan. */
  canRate: boolean;
  items: PlanRatingDTO[];
  nextCursor: string | null;
}

type RatingRow = {
  id: string;
  plan_id: string;
  user_id: string;
  rating: number;
  review: string | null;
  coach_response: string | null;
  coach_responded_at: string | null;
  created_at: string;
  updated_at: string;
};

const RATING_COLUMNS =
  "id, plan_id, user_id, rating, review, coach_response, coach_responded_at, created_at, updated_at";

export function encodeRatingsCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString("base64url");
}

export function decodeRatingsCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof createdAt === "string" &&
      !Number.isNaN(Date.parse(createdAt)) &&
      z.string().uuid().safeParse(id).success
    ) {
      return { createdAt, id };
    }
  } catch {
    // Falls through to the 400 below.
  }
  throw new ApiError({ code: "validation_failed", status: 400, message: "Invalid cursor." });
}

/** "Greta S." from a first and last name; just the first name when there's no last. */
export function reviewerName(firstName: string, lastName: string | null | undefined): string {
  const initial = lastName?.trim().charAt(0);
  return initial ? `${firstName.trim()} ${initial.toUpperCase()}.` : firstName.trim();
}

type Reviewer = PlanRatingDTO["reviewer"];

/**
 * Display names for these reviewers. Someone who is both an athlete and a
 * parent shows as the athlete when they're this plan's athlete.
 */
async function loadReviewers(
  admin: Client,
  userIds: string[],
  planAthleteId: string | null,
): Promise<Map<string, Reviewer>> {
  const reviewers = new Map<string, Reviewer>();
  if (!userIds.length) return reviewers;
  const [athletes, parents] = await Promise.all([
    admin.from("athletes").select("id, user_id, first_name, last_name").in("user_id", userIds),
    admin.from("parent_profiles").select("user_id, first_name, last_name").in("user_id", userIds),
  ]);
  if (athletes.error) dbError(athletes.error);
  if (parents.error) dbError(parents.error);
  for (const p of parents.data ?? []) {
    reviewers.set(p.user_id, { name: reviewerName(p.first_name, p.last_name), role: "parent" });
  }
  for (const a of athletes.data ?? []) {
    if (!a.user_id) continue;
    if (reviewers.has(a.user_id) && a.id !== planAthleteId) continue;
    reviewers.set(a.user_id, { name: reviewerName(a.first_name, a.last_name), role: "athlete" });
  }
  return reviewers;
}

function toDto(row: RatingRow, reviewer: Reviewer | undefined): PlanRatingDTO {
  return {
    id: row.id,
    rating: row.rating,
    review: row.review,
    reviewer: reviewer ?? { name: "Gradus member", role: "parent" },
    coachResponse: row.coach_response,
    coachRespondedAt: row.coach_responded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function canRatePlan(supabase: Client, planId: string): Promise<boolean> {
  const { data, error } = await untyped(supabase).rpc("can_rate_plan", { _plan_id: planId });
  if (error) dbError(error);
  return data === true;
}

type PlanForRatings = {
  id: string;
  athlete_id: string | null;
  status: string;
  rating_avg: number | string | null;
  rating_count: number;
  coach: { subscription_tier: string | null; organization_id: string | null } | null;
};

/**
 * The plan, when the caller may read its reviews: they can see the plan
 * itself (its coach, athlete, or parents), or it's a marketplace listing (an
 * active plan by a Coach Pro coach, as in marketplace-plans.server.ts).
 */
async function loadReadablePlan(ctx: PlanRatingsContext, planId: string): Promise<PlanForRatings> {
  const [visible, plan] = await Promise.all([
    ctx.supabase.from("plans").select("id").eq("id", planId).maybeSingle(),
    untyped(ctx.admin)
      .from("plans")
      .select(
        "id, athlete_id, status, rating_avg, rating_count, coach:coach_profiles(subscription_tier, organization_id)",
      )
      .eq("id", planId)
      .maybeSingle(),
  ]);
  if (visible.error) dbError(visible.error);
  if (plan.error) dbError(plan.error);
  const row = plan.data as PlanForRatings | null;
  if (!row) throw notFound("Plan not found");
  const listed =
    row.status === "active" &&
    row.coach?.subscription_tier === "coach_pro" &&
    row.coach.organization_id === null;
  if (!visible.data && !listed) throw notFound("Plan not found");
  return row;
}

function toSummary(plan: PlanForRatings): PlanRatingSummary {
  return {
    // PostgREST sends numeric as a number, or as a string past float precision.
    average: plan.rating_avg === null ? null : Number(plan.rating_avg),
    count: plan.rating_count ?? 0,
  };
}

/** A plan's average rating and how many ratings it has; `average` is null with none. */
export async function getPlanRatingSummary(
  ctx: PlanRatingsContext,
  planId: string,
): Promise<PlanRatingSummary> {
  return toSummary(await loadReadablePlan(ctx, planId));
}

export async function listPlanRatings(
  ctx: PlanRatingsContext,
  planId: string,
  input: z.infer<typeof listPlanRatingsQuery>,
): Promise<PlanRatingsPageDTO> {
  const plan = await loadReadablePlan(ctx, planId);
  const after = input.cursor ? decodeRatingsCursor(input.cursor) : null;

  let query = untyped(ctx.admin)
    .from("plan_ratings")
    .select(RATING_COLUMNS)
    .eq("plan_id", planId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (after) {
    query = query.or(
      `created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`,
    );
  }
  const [page, mine, canRate] = await Promise.all([
    query.limit(input.limit + 1),
    untyped(ctx.admin)
      .from("plan_ratings")
      .select(RATING_COLUMNS)
      .eq("plan_id", planId)
      .eq("user_id", ctx.userId)
      .maybeSingle(),
    canRatePlan(ctx.supabase, planId),
  ]);
  if (page.error) dbError(page.error);
  if (mine.error) dbError(mine.error);

  const rows = (page.data ?? []) as RatingRow[];
  const items = rows.slice(0, input.limit);
  const last = items[items.length - 1];
  const myRow = mine.data as RatingRow | null;
  const reviewers = await loadReviewers(
    ctx.admin,
    [...new Set([...items.map((r) => r.user_id), ...(myRow ? [myRow.user_id] : [])])],
    plan.athlete_id,
  );

  return {
    summary: toSummary(plan),
    myRating: myRow ? toDto(myRow, reviewers.get(myRow.user_id)) : null,
    canRate,
    items: items.map((r) => toDto(r, reviewers.get(r.user_id))),
    nextCursor:
      rows.length > input.limit && last ? encodeRatingsCursor(last.created_at, last.id) : null,
  };
}

/** Rates the plan, or changes the caller's earlier rating of it. */
export async function ratePlan(
  ctx: PlanRatingsContext,
  planId: string,
  input: z.infer<typeof ratePlanInput>,
  now: Date = new Date(),
): Promise<PlanRatingDTO> {
  if (!(await canRatePlan(ctx.supabase, planId))) {
    throw forbidden("Only the plan's athlete and their parents can rate it.");
  }
  const { data, error } = await untyped(ctx.supabase)
    .from("plan_ratings")
    .upsert(
      {
        plan_id: planId,
        user_id: ctx.userId,
        rating: input.rating,
        review: input.review || null,
        updated_at: now.toISOString(),
      },
      { onConflict: "plan_id,user_id" },
    )
    .select(RATING_COLUMNS)
    .single();
  if (error) dbError(error);
  const row = data as RatingRow;
  const { data: plan, error: planError } = await ctx.admin
    .from("plans")
    .select("athlete_id")
    .eq("id", planId)
    .maybeSingle();
  if (planError) dbError(planError);
  const reviewers = await loadReviewers(ctx.admin, [row.user_id], plan?.athlete_id ?? null);
  return toDto(row, reviewers.get(row.user_id));
}

/** Removes the caller's rating of the plan; none to remove is still a 200. */
export async function deleteMyPlanRating(
  ctx: PlanRatingsContext,
  planId: string,
): Promise<{ ok: true }> {
  const { error } = await untyped(ctx.supabase)
    .from("plan_ratings")
    .delete()
    .eq("plan_id", planId)
    .eq("user_id", ctx.userId);
  if (error) dbError(error);
  return { ok: true };
}

/** The plan coach's reply to one rating; `response: null` removes it. */
export async function respondToPlanRating(
  ctx: PlanRatingsContext,
  planId: string,
  ratingId: string,
  input: z.infer<typeof respondToRatingInput>,
  now: Date = new Date(),
): Promise<PlanRatingDTO> {
  const { data: isCoach, error: coachError } = await untyped(ctx.supabase).rpc("is_plan_coach", {
    _plan_id: planId,
  });
  if (coachError) dbError(coachError);
  if (isCoach !== true) throw forbidden("Only the plan's coach can reply to its ratings.");

  const { data, error } = await untyped(ctx.supabase)
    .from("plan_ratings")
    .update({
      coach_response: input.response,
      coach_responded_at: input.response === null ? null : now.toISOString(),
    })
    .eq("id", ratingId)
    .eq("plan_id", planId)
    .select(RATING_COLUMNS)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw notFound("Rating not found");
  const row = data as RatingRow;
  const { data: plan, error: planError } = await ctx.admin
    .from("plans")
    .select("athlete_id")
    .eq("id", planId)
    .maybeSingle();
  if (planError) dbError(planError);
  const reviewers = await loadReviewers(ctx.admin, [row.user_id], plan?.athlete_id ?? null);
  return toDto(row, reviewers.get(row.user_id));
}
