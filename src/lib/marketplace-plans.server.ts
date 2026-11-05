/**
 * The plan marketplace read side (`GET /api/v1/marketplace/plans`). A listing
 * is an active plan whose coach is on Coach Pro, the same rule as
 * `public.coach_effective_tier()`: `subscription_tier = 'coach_pro'` and no
 * club. The caller never sees their own plans, or the plans assigned to them
 * or to the athletes they guard. Purchases aren't recorded anywhere yet, so an
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
import { dbError } from "./db-error";
import { listingCoverUrls } from "./plan-marketplace-fields.server";
import { guardianAthleteAccess } from "./team.server";

type Admin = SupabaseClient<Database>;

export type MarketplaceContext = { userId: string; admin: Admin };

export interface MarketplacePlanDTO {
  id: string;
  title: string;
  kind: "plan" | "template";
  moveCount: number;
  /** USD; 0 is free (migration 20261103120000_plans_price_media). */
  price: number;
  /**
   * "plan" or "program", the level the plan is for, and its description
   * (20261104120000_plans_product_type_level_description); null when unset.
   */
  productType: "plan" | "program" | null;
  selectedLevel: string | null;
  /** The other end of a level range (20261107120000); null for a single level. */
  selectedLevelTo: string | null;
  description: string | null;
  /** Rating totals (20261106120000_plan_ratings); `average` is null with no ratings. */
  rating: { average: number | null; count: number };
  /**
   * The cover to show: Gradus default artwork, or a signed link (an hour) to the
   * coach's uploaded photo; null when there's none.
   */
  media: string | null;
  updatedAt: string;
  /** `verified`: the coach finished identity verification (their setup checklist). */
  coach: { id: string; firstName: string; lastName: string; verified: boolean };
}

/**
 * `GET /api/v1/marketplace/plans` `[page]`:
 * `?q=&minPrice=&maxPrice=&limit=20&cursor=<opaque>`, newest first. `q`
 * matches the plan title or the coach's name; the price bounds are inclusive.
 */
export const marketplacePlansQuery = z.object({
  q: z.string().trim().max(100).optional(),
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

/** Whose plans the caller already has: their own as a coach, and their athletes' and children's. */
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
  selected_level: string | null;
  selected_level_to: string | null;
  description: string | null;
  rating_avg: number | string | null;
  rating_count: number | null;
  media: string | null;
  updated_at: string;
  coach: {
    id: string;
    first_name: string;
    last_name: string;
    checklist: { identityVerification?: unknown } | null;
  };
};

export async function getMarketplacePlans(
  ctx: MarketplaceContext,
  input: z.infer<typeof marketplacePlansQuery>,
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
      "id, title, kind, price, product_type, selected_level, selected_level_to, description, rating_avg, rating_count, media, updated_at, coach:coach_profiles!inner(id, first_name, last_name, checklist, subscription_tier, organization_id)",
    )
    .eq("status", "active")
    .eq("coach.subscription_tier", "coach_pro")
    .is("coach.organization_id", null)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false });
  if (scope.coachId) query = query.neq("coach_id", scope.coachId);
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
  if (page.length) {
    const moves = await admin
      .from("plan_moves")
      .select("plan_id")
      .in(
        "plan_id",
        page.map((p) => p.id),
      );
    if (moves.error) dbError(moves.error);
    for (const m of moves.data ?? []) {
      moveCounts.set(m.plan_id, (moveCounts.get(m.plan_id) ?? 0) + 1);
    }
  }

  const covers = await listingCoverUrls(
    admin as unknown as Parameters<typeof listingCoverUrls>[0],
    page.map((row) => row.media),
  );

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
      selectedLevel: row.selected_level,
      selectedLevelTo: row.selected_level_to,
      description: row.description,
      rating: {
        average: row.rating_avg === null ? null : Number(row.rating_avg),
        count: row.rating_count ?? 0,
      },
      media: covers[i],
      updatedAt: row.updated_at,
      coach: {
        id: row.coach.id,
        firstName: row.coach.first_name,
        lastName: row.coach.last_name,
        verified: row.coach.checklist?.identityVerification === true,
      },
    })),
    nextCursor,
  };
}
