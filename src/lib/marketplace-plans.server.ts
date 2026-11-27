/**
 * The plan marketplace read side (`GET /api/v1/marketplace/plans`). A listing
 * is an active plan whose coach is on Coach Pro, the same rule as
 * `public.coach_effective_tier()`: `subscription_tier = 'coach_pro'` and no
 * club. A coach sees their own plans too, flagged `isOwn` so the apps hide
 * Buy; nobody sees the plans assigned to them or to the athletes they guard. Purchases aren't recorded anywhere yet, so an
 * "already bought" plan can't be left out; add that here once they are.
 *
 * Another coach's plan is invisible to the caller's RLS client, so reads go
 * through the service role and return listing fields only: never notes,
 * moves, or the athlete a plan belongs to.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { signedCoachPhotoUrl, signedCoachPhotoUrls } from "./coach-photo.server";
import { coachRatingSummary } from "./coach-ratings.server";
import { dbError } from "./db-error";
import {
  isDefaultPlanMedia,
  listingCover,
  listingCoverUrls,
} from "./plan-marketplace-fields.server";
import { verifiedCoachIds } from "./coach-verification.server";
import { guardianAthleteAccess } from "./team.server";

type Admin = SupabaseClient<Database>;

export type MarketplaceContext = { userId: string; admin: Admin };

/** A plan's first move: what it is and how to do it, never the rest of the plan. */
export interface MarketplaceSampleMoveDTO {
  name: string;
  targetKind: string;
  targetValue: number;
  cue: string | null;
  why: string | null;
}

export interface MarketplacePlanDTO {
  id: string;
  title: string;
  kind: "plan" | "template";
  moveCount: number;
  /** USD; 0 is free (migration 20261111120000_plans_price_media). */
  price: number;
  /**
   * "plan" or "program", the level the plan is for, and its description
   * (20261111120100_plans_product_type_level_description); null when unset.
   */
  productType: "plan" | "program" | null;
  /** The sport the plan is for ("figure_skating"; 20261124120000_plans_sport); null when unset. */
  sport: string | null;
  selectedLevel: string | null;
  /** The other end of a level range (20261111120400); null for a single level. */
  selectedLevelTo: string | null;
  description: string | null;
  /** Weeks it runs, practice sessions per week, a Program's lessons (20261111120500); null when unset. */
  weeks: number | null;
  sessionsPerWeek: number | null;
  lessonCount: number | null;
  /** Rating totals (20261111120300_plan_ratings); `average` is null with no ratings. */
  rating: { average: number | null; count: number };
  /**
   * The cover to show: Gradus default artwork, or a signed link (an hour) to the
   * coach's uploaded photo; null when there's none.
   */
  media: string | null;
  /**
   * The cover video to show instead, a signed link (an hour): set only when the plan has no
   * coach-uploaded image but has a video. Clients play it in place of `media`.
   */
  mediaVideo: string | null;
  /** When the coach made the plan. */
  createdAt: string;
  updatedAt: string;
  /** The plan's first move, shown as a free sample; null when it has none. */
  sampleMove: MarketplaceSampleMoveDTO | null;
  /**
   * `verified`: the coach finished identity verification (their setup checklist).
   * `photoUrl`: a link (an hour) to their profile photo; null when they have none.
   * `canSell`: their Stripe payouts are set up; until then nobody can buy their plans.
   */
  coach: {
    id: string;
    firstName: string;
    lastName: string;
    verified: boolean;
    photoUrl: string | null;
    canSell: boolean;
  };
  /** The caller is the coach who made it: show it, but no Buy. */
  isOwn: boolean;
  /**
   * The caller's purchases of this listing: for an athlete, their own; for a
   * parent, one per child they bought it for. `planId` is that athlete's copy.
   */
  purchases: MarketplacePurchaseRef[];
}

/** One of the caller's purchases of a listing: who it's for, their copy, and whether it's paid. */
export interface MarketplacePurchaseRef {
  purchaseId: string;
  athleteId: string;
  planId: string | null;
  paymentStatus: "awaiting_coach_setup" | "payment_due" | "processing" | "paid";
}

/**
 * `GET /api/v1/marketplace/plans` `[page]`:
 * `?q=&sport=&minPrice=&maxPrice=&limit=20&cursor=<opaque>`, newest first. `q`
 * matches the plan title or the coach's name; `sport` is a sport key
 * ("figure_skating"); the price bounds are inclusive.
 */
export const marketplacePlansQuery = z.object({
  q: z.string().trim().max(100).optional(),
  sport: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,64}$/)
    .optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(200).optional(),
});

/** Opaque, URL-safe page cursor: the last listing of the page just served. */
export function encodeMarketplaceCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ u: updatedAt, i: id }), "utf8").toString("base64url");
}

export function decodeMarketplaceCursor(cursor: string): { updatedAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      u?: unknown;
      i?: unknown;
    };
    if (typeof parsed.u !== "string" || typeof parsed.i !== "string" || !parsed.u || !parsed.i) {
      throw new Error("shape");
    }
    if (Number.isNaN(Date.parse(parsed.u))) throw new Error("date");
    if (!z.string().uuid().safeParse(parsed.i).success) throw new Error("id");
    return { updatedAt: parsed.u, id: parsed.i };
  } catch {
    throw new ApiError({ code: "validation_failed", status: 400, message: "Bad cursor." });
  }
}

/**
 * The words of a search, stripped of the characters PostgREST filter strings
 * treat as syntax (`,()*%\:"'`), at most five.
 */
export function searchTerms(q: string | undefined): string[] {
  if (!q) return [];
  return q
    .replace(/[,()*%\\:"']/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
}

/** Several `or(...)` groups that must all hold, as one PostgREST `or` filter. */
export function allOf(groups: string[]): string | null {
  if (groups.length === 0) return null;
  if (groups.length === 1) return groups[0];
  return `and(${groups.map((g) => `or(${g})`).join(",")})`;
}

/** Who the caller is as a coach (their own plans), and the athletes whose plans they already have. */
async function viewerScope(
  admin: Admin,
  userId: string,
): Promise<{ coachId: string | null; athleteIds: string[] }> {
  const [coachRes, athletesRes, parentRes] = await Promise.all([
    admin.from("coach_profiles").select("id").eq("user_id", userId).maybeSingle(),
    admin.from("athletes").select("id").eq("user_id", userId),
    admin.from("parent_profiles").select("id").eq("user_id", userId).maybeSingle(),
  ]);
  if (coachRes.error) dbError(coachRes.error);
  if (athletesRes.error) dbError(athletesRes.error);
  if (parentRes.error) dbError(parentRes.error);

  const athleteIds = new Set((athletesRes.data ?? []).map((a) => a.id));
  if (parentRes.data) {
    for (const a of await guardianAthleteAccess(admin, parentRes.data.id)) {
      athleteIds.add(a.athleteId);
    }
  }
  return { coachId: coachRes.data?.id ?? null, athleteIds: Array.from(athleteIds) };
}

/**
 * Fulfilled purchases among `planIds` that the caller made, or that anyone made
 * for one of the caller's athletes (their own, or a parent's children): listing
 * id → who it was bought for. Matches the `already_purchased` check in
 * `startPlanCheckout`, which goes by athlete, not buyer, so a plan the other
 * parent (or the athlete) bought never shows Buy.
 */
async function viewerPurchases(
  admin: Admin,
  userId: string,
  athleteIds: string[],
  planIds: string[],
): Promise<Map<string, MarketplacePurchaseRef[]>> {
  const out = new Map<string, MarketplacePurchaseRef[]>();
  if (planIds.length === 0) return out;
  // The generated types don't know plan_purchases yet (20261111120800_plan_purchases).
  const { data, error } = await (admin as unknown as { from: (t: string) => any }) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from("plan_purchases")
    .select("id, plan_id, athlete_id, buyer_user_id, copied_plan_id, payment_status")
    .or(
      athleteIds.length
        ? `buyer_user_id.eq.${userId},athlete_id.in.(${athleteIds.join(",")})`
        : `buyer_user_id.eq.${userId}`,
    )
    .eq("status", "fulfilled")
    .in("plan_id", planIds);
  if (error) dbError(error);
  const rows = (data ?? []) as {
    id: string;
    plan_id: string;
    athlete_id: string | null;
    buyer_user_id: string | null;
    copied_plan_id: string | null;
    payment_status: MarketplacePurchaseRef["paymentStatus"] | null;
  }[];
  // The caller's own purchase first, so it wins for "Complete payment" when there are two.
  rows.sort((a, b) => Number(b.buyer_user_id === userId) - Number(a.buyer_user_id === userId));
  for (const p of rows) {
    if (!p.athlete_id) continue;
    if (out.get(p.plan_id)?.some((r) => r.athleteId === p.athlete_id)) continue;
    out.set(p.plan_id, [
      ...(out.get(p.plan_id) ?? []),
      {
        purchaseId: p.id,
        athleteId: p.athlete_id,
        planId: p.copied_plan_id,
        paymentStatus: p.payment_status ?? "paid",
      },
    ]);
  }
  return out;
}

/** Coach Pro coaches whose name contains every search term. */
async function coachIdsMatching(admin: Admin, terms: string[]): Promise<string[]> {
  if (terms.length === 0) return [];
  let query = admin
    .from("coach_profiles")
    .select("id")
    .eq("subscription_tier", "coach_pro")
    .is("organization_id", null);
  for (const term of terms) {
    query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
  }
  const { data, error } = await query.limit(200);
  if (error) dbError(error);
  return (data ?? []).map((c) => c.id);
}

type ListingRow = {
  id: string;
  title: string;
  kind: string;
  price: number | string;
  product_type: string | null;
  sport: string | null;
  selected_level: string | null;
  selected_level_to: string | null;
  description: string | null;
  weeks: number | null;
  sessions_per_week: number | null;
  lesson_count: number | null;
  rating_avg: number | string | null;
  rating_count: number | null;
  media: string | null;
  media_video: string | null;
  created_at: string;
  updated_at: string;
  coach: {
    id: string;
    first_name: string;
    last_name: string;
    checklist: { identityVerification?: unknown } | null;
    photo_url: string | null;
    subscription_tier: string | null;
    organization_id: string | null;
    stripe_connect_account_id: string | null;
    stripe_connect_charges_enabled: boolean | null;
    stripe_connect_payouts_enabled: boolean | null;
  };
};

export async function getMarketplacePlans(
  ctx: MarketplaceContext,
  input: z.infer<typeof marketplacePlansQuery>,
  /** One coach's listings only (the coach profile). */
  opts: { coachId?: string } = {},
): Promise<{ items: MarketplacePlanDTO[]; nextCursor: string | null }> {
  const { admin } = ctx;
  if (
    input.minPrice !== undefined &&
    input.maxPrice !== undefined &&
    input.minPrice > input.maxPrice
  ) {
    throw new ApiError({
      code: "validation_failed",
      status: 400,
      message: "minPrice can't be more than maxPrice.",
    });
  }
  const after = input.cursor ? decodeMarketplaceCursor(input.cursor) : null;
  const terms = searchTerms(input.q);
  const [scope, matchingCoachIds] = await Promise.all([
    viewerScope(admin, ctx.userId),
    coachIdsMatching(admin, terms),
  ]);

  let query = admin
    .from("plans")
    .select(
      "id, title, kind, price, product_type, sport, selected_level, selected_level_to, description, weeks, sessions_per_week, lesson_count, rating_avg, rating_count, media, media_video, created_at, updated_at, coach:coach_profiles!inner(id, first_name, last_name, checklist, photo_url, subscription_tier, organization_id, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled)",
    )
    .eq("status", "active")
    .eq("coach.subscription_tier", "coach_pro")
    .is("coach.organization_id", null)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false });
  if (opts.coachId) query = query.eq("coach_id", opts.coachId);
  // `sport` isn't in the generated types yet; the key is checked to [a-z0-9_] above.
  if (input.sport) query = query.or(`sport.eq.${input.sport}`);
  if (input.minPrice !== undefined) query = query.gte("price", input.minPrice);
  if (input.maxPrice !== undefined) query = query.lte("price", input.maxPrice);

  const groups: string[] = [];
  if (scope.athleteIds.length) {
    // Templates have no athlete; NOT IN alone would drop them with the NULLs.
    groups.push(`athlete_id.is.null,athlete_id.not.in.(${scope.athleteIds.join(",")})`);
  }
  if (terms.length) {
    const byTitle = `and(${terms.map((t) => `title.ilike.%${t}%`).join(",")})`;
    groups.push(
      matchingCoachIds.length ? `${byTitle},coach_id.in.(${matchingCoachIds.join(",")})` : byTitle,
    );
  }
  if (after) {
    groups.push(
      `updated_at.lt.${after.updatedAt},and(updated_at.eq.${after.updatedAt},id.lt.${after.id})`,
    );
  }
  const filter = allOf(groups);
  if (filter) query = query.or(filter);

  const { data, error } = await query.limit(input.limit + 1);
  if (error) dbError(error);

  const rows = (data ?? []) as unknown as ListingRow[];
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > input.limit && last ? encodeMarketplaceCursor(last.updated_at, last.id) : null;

  const moveCounts = new Map<string, number>();
  const samples = new Map<string, MarketplaceSampleMoveDTO>();
  if (page.length) {
    const moves = await admin
      .from("plan_moves")
      .select("plan_id, position, name, cue, why, target_kind, target_value")
      .in(
        "plan_id",
        page.map((p) => p.id),
      )
      .order("position", { ascending: true });
    if (moves.error) dbError(moves.error);
    for (const m of moves.data ?? []) {
      moveCounts.set(m.plan_id, (moveCounts.get(m.plan_id) ?? 0) + 1);
      // Ordered by position: the first one seen is the plan's first move.
      if (!samples.has(m.plan_id)) {
        samples.set(m.plan_id, {
          name: m.name,
          targetKind: m.target_kind,
          targetValue: Number(m.target_value),
          cue: m.cue || null,
          why: m.why || null,
        });
      }
    }
  }

  // The coach's own image, else their video, else default artwork (`listingCover`):
  // images and videos are signed in the same call.
  const chosen = page.map((row) => listingCover(row.media, row.media_video));
  const imageUrls = page.map((row, i) =>
    chosen[i]?.kind === "image"
      ? chosen[i]!.url
      : row.media && isDefaultPlanMedia(row.media)
        ? row.media
        : null,
  );
  const videoUrls = chosen.map((c) => (c?.kind === "video" ? c.url : null));
  const [signedCovers, coachPhotos, bought, verifiedIds] = await Promise.all([
    listingCoverUrls(admin as unknown as Parameters<typeof listingCoverUrls>[0], [
      ...imageUrls,
      ...videoUrls,
    ]),
    signedCoachPhotoUrls(
      admin as unknown as Parameters<typeof signedCoachPhotoUrls>[0],
      page.map((row) => ({ id: row.coach.id, photoUrl: row.coach.photo_url })),
    ),
    viewerPurchases(
      admin,
      ctx.userId,
      scope.athleteIds,
      page.map((row) => row.id),
    ),
    // The Verified badge: only coaches who passed identity verification.
    verifiedCoachIds(
      admin,
      page.map((row) => row.coach.id),
    ),
  ]);
  const covers = signedCovers.slice(0, page.length);
  const videos = signedCovers.slice(page.length);

  return {
    items: page.map((row, i) => ({
      id: row.id,
      title: row.title,
      kind: row.kind === "template" ? "template" : "plan",
      moveCount: moveCounts.get(row.id) ?? 0,
      // PostgREST sends numeric as a number, or as a string past float precision.
      price: Number(row.price),
      productType:
        row.product_type === "plan" || row.product_type === "program" ? row.product_type : null,
      sport: row.sport,
      selectedLevel: row.selected_level,
      selectedLevelTo: row.selected_level_to,
      description: row.description,
      weeks: row.weeks,
      sessionsPerWeek: row.sessions_per_week,
      lessonCount: row.lesson_count,
      rating: {
        average: row.rating_avg === null ? null : Number(row.rating_avg),
        count: row.rating_count ?? 0,
      },
      media: covers[i],
      mediaVideo: videos[i],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sampleMove: samples.get(row.id) ?? null,
      coach: {
        id: row.coach.id,
        firstName: row.coach.first_name,
        lastName: row.coach.last_name,
        verified: isVerifiedCoach(row.coach, verifiedIds.has(row.coach.id)),
        photoUrl: coachPhotos.get(row.coach.id) ?? null,
        canSell:
          !!row.coach.stripe_connect_account_id &&
          row.coach.stripe_connect_charges_enabled === true &&
          row.coach.stripe_connect_payouts_enabled === true,
      },
      isOwn: scope.coachId !== null && row.coach.id === scope.coachId,
      purchases: bought.get(row.id) ?? [],
    })),
    nextCursor,
  };
}

/* ---------------------------------------------------------- coach profile */

/** `GET /api/v1/marketplace/coaches/{id}`: what's on file about a coach who sells plans, and their listings. */
export interface MarketplaceCoachDTO {
  coach: {
    id: string;
    firstName: string;
    lastName: string;
    /** Coach Pro and passed identity verification (`isVerifiedCoach`): the Verified badge. */
    verified: boolean;
    /** A link (an hour) to their profile photo; null when they have none. */
    photoUrl: string | null;
    /** The caller is this coach: they may change the photo. */
    isMe: boolean;
    /** When they finished onboarding ("On Gradus since …"); null before that. */
    onboardedAt: string | null;
    /** The sports they coach, in the order they added them. */
    sports: string[];
    /** Each sport and level they coach (`coach_levels`). */
    levels: { sport: string; levelKey: string }[];
  };
  /** Across all their active plans, weighted by each plan's rating count; `average` is null with none. */
  rating: { average: number | null; count: number };
  /** Ratings of the coach themselves (`coach_ratings`, src/lib/coach-ratings.server.ts); `average` is null with none. */
  coachRating: { average: number | null; count: number };
  /** Their listings, as `GET /api/v1/marketplace/plans` shows them to the caller. */
  plans: MarketplacePlanDTO[];
}

/** The coach profile shows at most this many listings: 4 pages of 50. */
const COACH_PROFILE_PAGES = 4;

const coachNotFound = () =>
  new ApiError({ code: "not_found", status: 404, message: "Coach not found." });

/**
 * A marketplace coach: only one the listing would show (Coach Pro, no club),
 * so the profile never reveals a coach who doesn't sell plans. Bio and
 * location aren't stored yet, so they aren't returned.
 */
/**
 * The Verified badge: the coach is on Coach Pro (not through a club), as
 * `public.coach_effective_tier()` counts it. Every coach the marketplace lists
 * is, so it shows on all of them.
 */
export function isVerifiedCoach(
  coach: { subscription_tier: string | null; organization_id: string | null },
  /** The coach passed identity verification (coach_verifications; `verifiedCoachIds`). */
  identityVerified: boolean,
): boolean {
  return (
    coach.subscription_tier === "coach_pro" && coach.organization_id === null && identityVerified
  );
}

export async function getMarketplaceCoach(
  ctx: MarketplaceContext,
  coachId: string,
): Promise<MarketplaceCoachDTO> {
  const { admin } = ctx;
  const coachRes = await admin
    .from("coach_profiles")
    .select(
      "id, user_id, first_name, last_name, checklist, onboarded_at, subscription_tier, organization_id, photo_url, rating_avg, rating_count",
    )
    .eq("id", coachId)
    .maybeSingle();
  if (coachRes.error) dbError(coachRes.error);
  // The generated types don't know photo_url (20261111120600_coach_profiles_photo) or the
  // rating totals (20261111121200_coach_ratings) yet.
  const coach = coachRes.data as unknown as {
    id: string;
    user_id: string;
    photo_url: string | null;
    rating_avg: number | string | null;
    rating_count: number | null;
    first_name: string;
    last_name: string;
    checklist: { identityVerification?: unknown } | null;
    onboarded_at: string | null;
    subscription_tier: string | null;
    organization_id: string | null;
  } | null;
  if (!coach || coach.subscription_tier !== "coach_pro" || coach.organization_id !== null) {
    throw coachNotFound();
  }

  const [levelsRes, ratingsRes] = await Promise.all([
    admin
      .from("coach_levels")
      .select("sport, level_key, created_at")
      .eq("coach_id", coachId)
      .order("created_at", { ascending: true }),
    admin
      .from("plans")
      .select("rating_avg, rating_count")
      .eq("coach_id", coachId)
      .eq("status", "active"),
  ]);
  if (levelsRes.error) dbError(levelsRes.error);
  if (ratingsRes.error) dbError(ratingsRes.error);

  const levels = ((levelsRes.data ?? []) as { sport: string; level_key: string }[]).map((l) => ({
    sport: l.sport,
    levelKey: l.level_key,
  }));

  let weighted = 0;
  let count = 0;
  // The generated types don't know the rating columns yet (20261111120300_plan_ratings).
  for (const r of (ratingsRes.data ?? []) as unknown as {
    rating_avg: number | string | null;
    rating_count: number | null;
  }[]) {
    const n = r.rating_count ?? 0;
    if (n > 0 && r.rating_avg !== null) {
      weighted += Number(r.rating_avg) * n;
      count += n;
    }
  }

  const photoUrl = await signedCoachPhotoUrl(admin, coach.id, coach.photo_url);

  const plans: MarketplacePlanDTO[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < COACH_PROFILE_PAGES; page++) {
    const res = await getMarketplacePlans(ctx, { limit: 50, cursor }, { coachId });
    plans.push(...res.items);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }

  return {
    coach: {
      id: coach.id,
      firstName: coach.first_name,
      lastName: coach.last_name,
      verified: isVerifiedCoach(coach, (await verifiedCoachIds(admin, [coach.id])).has(coach.id)),
      photoUrl,
      isMe: coach.user_id === ctx.userId,
      onboardedAt: coach.onboarded_at,
      sports: Array.from(new Set(levels.map((l) => l.sport))),
      levels,
    },
    rating: { average: count > 0 ? Math.round((weighted / count) * 100) / 100 : null, count },
    coachRating: coachRatingSummary(coach),
    plans,
  };
}
