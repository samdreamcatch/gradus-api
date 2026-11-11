/**
 * Coach ratings (migration 20261111121200_coach_ratings): 1–5 stars and an
 * optional review of a coach, one per person per coach, and an optional reply
 * from the coach. The coach-level twin of plan-ratings.server.ts, with the
 * same shapes, so a client draws both the same way.
 *
 * Who may rate is the database's rule, `public.can_rate_coach()`: someone who
 * has worked with the coach (an athlete on their roster or that athlete's
 * parent, or anyone with a delivered marketplace purchase from them), never
 * the coach. Writes go through the caller's RLS client, so the policies and
 * column guards apply; this module checks the same rule first only to answer
 * with a clear 403.
 *
 * Reviews are read through the service role, for anyone who can find the
 * coach in the marketplace (or has worked with them, or is them), and carry
 * the reviewer's first name and last initial only.
 *
 * `coach_ratings`, `coach_profiles.rating_avg/rating_count` and the helper
 * functions aren't in the generated types until Lovable regenerates them, so
 * they go through `untyped`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import {
  decodeRatingsCursor,
  encodeRatingsCursor,
  loadReviewers,
  type PlanRatingDTO,
  type PlanRatingSummary,
  type Reviewer,
} from "./plan-ratings.server";

type Client = SupabaseClient<Database>;

type Untyped = {
  from: (table: string) => any;
  rpc: (fn: "can_rate_coach" | "is_rated_coach", args: { _coach_id: string }) => any;
};
const untyped = (client: Client) => client as unknown as Untyped;

export type CoachRatingsContext = { userId: string; supabase: Client; admin: Client };

const forbidden = (message: string) => new ApiError({ code: "forbidden", status: 403, message });
const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });

export const rateCoachInput = z.object({
  rating: z.number().int().min(1).max(5),
  /** Optional written review; null or absent leaves none. */
  review: z.string().trim().max(2000).nullable().optional(),
});

export const respondToCoachRatingInput = z.object({
  /** The coach's reply; null removes it. */
  response: z.string().trim().min(1).max(2000).nullable(),
});

export const listCoachRatingsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

/** Same shape as a plan rating. */
export type CoachRatingDTO = PlanRatingDTO;
export type CoachRatingSummary = PlanRatingSummary;

export interface CoachRatingsPageDTO {
  summary: CoachRatingSummary;
  /** The caller's own rating of this coach, if any. */
  myRating: CoachRatingDTO | null;
  /** Whether the caller may rate (or re-rate) this coach. */
  canRate: boolean;
  /** Whether the caller is this coach, who may reply to their ratings. */
  canRespond: boolean;
  items: CoachRatingDTO[];
  nextCursor: string | null;
}

type RatingRow = {
  id: string;
  coach_id: string;
  user_id: string;
  rating: number;
  review: string | null;
  coach_response: string | null;
  coach_responded_at: string | null;
  created_at: string;
  updated_at: string;
};

const RATING_COLUMNS =
  "id, coach_id, user_id, rating, review, coach_response, coach_responded_at, created_at, updated_at";

function toDto(row: RatingRow, reviewer: Reviewer | undefined): CoachRatingDTO {
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

async function canRateCoach(supabase: Client, coachId: string): Promise<boolean> {
  const { data, error } = await untyped(supabase).rpc("can_rate_coach", { _coach_id: coachId });
  if (error) dbError(error);
  return data === true;
}

async function isRatedCoach(supabase: Client, coachId: string): Promise<boolean> {
  const { data, error } = await untyped(supabase).rpc("is_rated_coach", { _coach_id: coachId });
  if (error) dbError(error);
  return data === true;
}

type CoachForRatings = {
  id: string;
  subscription_tier: string | null;
  organization_id: string | null;
  rating_avg: number | string | null;
  rating_count: number | null;
};

/**
 * The coach, when the caller may read their reviews: a marketplace coach
 * (Coach Pro, no club, as in marketplace-plans.server.ts), or the caller is
 * this coach or may rate them. Anyone else gets 404, so the API never
 * reveals a coach who doesn't sell plans.
 */
async function loadReadableCoach(
  ctx: CoachRatingsContext,
  coachId: string,
  access: { canRate: boolean; isCoach: boolean },
): Promise<CoachForRatings> {
  const { data, error } = await untyped(ctx.admin)
    .from("coach_profiles")
    .select("id, subscription_tier, organization_id, rating_avg, rating_count")
    .eq("id", coachId)
    .maybeSingle();
  if (error) dbError(error);
  const row = data as CoachForRatings | null;
  if (!row) throw notFound("Coach not found");
  const listed = row.subscription_tier === "coach_pro" && row.organization_id === null;
  if (!listed && !access.canRate && !access.isCoach) throw notFound("Coach not found");
  return row;
}

export function coachRatingSummary(
  coach: Pick<CoachForRatings, "rating_avg" | "rating_count">,
): CoachRatingSummary {
  return {
    // PostgREST sends numeric as a number, or as a string past float precision.
    average: coach.rating_avg === null ? null : Number(coach.rating_avg),
    count: coach.rating_count ?? 0,
  };
}

/** A coach's average rating and how many ratings they have; `average` is null with none. */
export async function getCoachRatingSummary(
  ctx: CoachRatingsContext,
  coachId: string,
): Promise<CoachRatingSummary> {
  const [canRate, isCoach] = await Promise.all([
    canRateCoach(ctx.supabase, coachId),
    isRatedCoach(ctx.supabase, coachId),
  ]);
  return coachRatingSummary(await loadReadableCoach(ctx, coachId, { canRate, isCoach }));
}

export async function listCoachRatings(
  ctx: CoachRatingsContext,
  coachId: string,
  input: z.infer<typeof listCoachRatingsQuery>,
): Promise<CoachRatingsPageDTO> {
  const [canRate, canRespond] = await Promise.all([
    canRateCoach(ctx.supabase, coachId),
    isRatedCoach(ctx.supabase, coachId),
  ]);
  const coach = await loadReadableCoach(ctx, coachId, { canRate, isCoach: canRespond });
  const after = input.cursor ? decodeRatingsCursor(input.cursor) : null;

  let query = untyped(ctx.admin)
    .from("coach_ratings")
    .select(RATING_COLUMNS)
    .eq("coach_id", coachId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (after) {
    query = query.or(
      `created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`,
    );
  }
  const [page, mine] = await Promise.all([
    query.limit(input.limit + 1),
    untyped(ctx.admin)
      .from("coach_ratings")
      .select(RATING_COLUMNS)
      .eq("coach_id", coachId)
      .eq("user_id", ctx.userId)
      .maybeSingle(),
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
    null,
  );

  return {
    summary: coachRatingSummary(coach),
    myRating: myRow ? toDto(myRow, reviewers.get(myRow.user_id)) : null,
    canRate,
    canRespond,
    items: items.map((r) => toDto(r, reviewers.get(r.user_id))),
    nextCursor:
      rows.length > input.limit && last ? encodeRatingsCursor(last.created_at, last.id) : null,
  };
}

/** Rates the coach, or changes the caller's earlier rating of them. */
export async function rateCoach(
  ctx: CoachRatingsContext,
  coachId: string,
  input: z.infer<typeof rateCoachInput>,
  now: Date = new Date(),
): Promise<CoachRatingDTO> {
  if (!(await canRateCoach(ctx.supabase, coachId))) {
    throw forbidden("Only athletes and parents who have worked with this coach can rate them.");
  }
  const { data, error } = await untyped(ctx.supabase)
    .from("coach_ratings")
    .upsert(
      {
        coach_id: coachId,
        user_id: ctx.userId,
        rating: input.rating,
        review: input.review || null,
        updated_at: now.toISOString(),
      },
      { onConflict: "coach_id,user_id" },
    )
    .select(RATING_COLUMNS)
    .single();
  if (error) dbError(error);
  const row = data as RatingRow;
  const reviewers = await loadReviewers(ctx.admin, [row.user_id], null);
  return toDto(row, reviewers.get(row.user_id));
}

/** Removes the caller's rating of the coach; none to remove is still a 200. */
export async function deleteMyCoachRating(
  ctx: CoachRatingsContext,
  coachId: string,
): Promise<{ ok: true }> {
  const { error } = await untyped(ctx.supabase)
    .from("coach_ratings")
    .delete()
    .eq("coach_id", coachId)
    .eq("user_id", ctx.userId);
  if (error) dbError(error);
  return { ok: true };
}

/** The coach's reply to one rating of them; `response: null` removes it. */
export async function respondToCoachRating(
  ctx: CoachRatingsContext,
  coachId: string,
  ratingId: string,
  input: z.infer<typeof respondToCoachRatingInput>,
  now: Date = new Date(),
): Promise<CoachRatingDTO> {
  if (!(await isRatedCoach(ctx.supabase, coachId))) {
    throw forbidden("Only the coach can reply to ratings of them.");
  }
  const { data, error } = await untyped(ctx.supabase)
    .from("coach_ratings")
    .update({
      coach_response: input.response,
      coach_responded_at: input.response === null ? null : now.toISOString(),
    })
    .eq("id", ratingId)
    .eq("coach_id", coachId)
    .select(RATING_COLUMNS)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw notFound("Rating not found");
  const row = data as RatingRow;
  const reviewers = await loadReviewers(ctx.admin, [row.user_id], null);
  return toDto(row, reviewers.get(row.user_id));
}
