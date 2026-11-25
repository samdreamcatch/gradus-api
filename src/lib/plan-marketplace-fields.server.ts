/**
 * The marketplace fields on a plan: `price`, in USD with 0 as free, and
 * `media`, the plan's one image as the authenticated Supabase Storage URL of an
 * object in the private `plan-media` bucket
 * (`<SUPABASE_URL>/storage/v1/object/authenticated/plan-media/<plan id>/<file>`)
 * (migration 20261111120000_plans_price_media); `productType`, `selectedLevel`
 * and `description` (20261111120100_plans_product_type_level_description); and
 * `selectedLevelTo`, the other end of a level range (20261111120400); and `sport`,
 * the sport the plan is for (20261124120000_plans_sport); and `mediaVideo`, the plan's
 * cover video in the same bucket (20261125120000_plans_media_video). The marketplace
 * shows the coach's own image, else the video, else default artwork (`listingCover`).
 *
 * A level is one key in `selectedLevel`, or a range: the first pick there and the
 * second in `selectedLevelTo`. Sending `selectedLevel` alone makes it a single
 * level (the old range end is cleared).
 * The plan create, save and patch routes write them; the coach's plan detail
 * reads them back.
 *
 * These columns aren't in the generated types until Lovable regenerates them,
 * so they're read and written through `untyped`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

type Untyped = { from: (table: "plans") => any };
const untyped = (client: Client) => client as unknown as Untyped;

/** Fits `numeric(10, 2)`. */
export const planPriceInput = z.number().min(0).max(99_999_999.99);
export const planMediaInput = z.string().url().max(2048);
/** A cover video: an MP4 or MOV upload in one of the coach's plan-media folders. */
export const planMediaVideoInput = z.string().url().max(2048);
export const planProductTypeInput = z.enum(["plan", "program"]);
/** The level the coach picked for the plan, as the frontend sends it. */
export const planSelectedLevelInput = z.string().trim().min(1).max(160);
export const planDescriptionInput = z.string().max(4000);
/** The sport the plan is for: a sport key from the app's catalog ("figure_skating"); filters the marketplace. */
export const planSportInput = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{1,64}$/, "sport must be a sport key like figure_skating");
/** How long the plan runs (the column checks match). */
export const planWeeksInput = z.number().int().min(1).max(52);
export const planSessionsPerWeekInput = z.number().int().min(1).max(14);
/** Lessons in a Program. */
export const planLessonCountInput = z.number().int().min(1).max(100);

export const PLAN_MEDIA_PATH = "/storage/v1/object/authenticated/plan-media/";

/**
 * Gradus's own cover artwork, hosted on Cloudinary: the image a plan gets when
 * the coach keeps the default instead of uploading a photo. Any plan may use
 * these; they aren't in anyone's plan-media folder.
 */
export const DEFAULT_PLAN_MEDIA_URLS: readonly string[] = [
  "https://res.cloudinary.com/sameer0075/image/upload/v1793896307/gradus-artwork-1_tl3lnl.png",
];

export function isDefaultPlanMedia(url: string): boolean {
  return DEFAULT_PLAN_MEDIA_URLS.includes(url);
}

const invalidMedia = () =>
  new ApiError({
    code: "unprocessable",
    status: 422,
    message:
      "media must be Gradus default artwork or the URL of an image uploaded to one of your plans in plan-media.",
  });

/**
 * The plan-media folder (a plan id) an authenticated object URL points into,
 * or null when the URL isn't one: another host, another bucket, the public or
 * signed form, or no file under the folder.
 */
export function planMediaFolder(
  url: string,
  supabaseUrl: string | undefined = process.env.SUPABASE_URL,
): string | null {
  return planMediaObjectPath(url, supabaseUrl)?.split("/")[0] ?? null;
}

/** The object's path in plan-media (`<plan id>/<file>`) for the same URLs `planMediaFolder` accepts. */
export function planMediaObjectPath(
  url: string,
  supabaseUrl: string | undefined = process.env.SUPABASE_URL,
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (supabaseUrl && parsed.origin !== new URL(supabaseUrl).origin) return null;
  if (!parsed.pathname.startsWith(PLAN_MEDIA_PATH)) return null;
  const path = decodeURIComponent(parsed.pathname.slice(PLAN_MEDIA_PATH.length));
  const [folder, ...file] = path.split("/");
  if (!file.join("/")) return null;
  return z.string().uuid().safeParse(folder).success ? path : null;
}

/** How long a listing's cover link works: long enough to browse, short enough not to leak. */
export const LISTING_COVER_TTL_SECONDS = 60 * 60;

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      createSignedUrls: (
        paths: string[],
        expiresIn: number,
      ) => Promise<{
        data: { path: string | null; signedUrl: string | null }[] | null;
        error: unknown;
      }>;
    };
  };
};

/**
 * A cover anyone browsing can load, per stored `media`: default artwork as it
 * is, an upload in the private plan-media bucket as a signed link (its storage
 * policies admit only the plan's coach), anything else null. One signing call
 * for the whole page; a failure leaves those covers null, never the listing.
 */
export async function listingCoverUrls(
  admin: StorageClient,
  media: (string | null)[],
): Promise<(string | null)[]> {
  const paths = media.map((url) =>
    url && !isDefaultPlanMedia(url) ? planMediaObjectPath(url) : null,
  );
  const toSign = [...new Set(paths.filter((p): p is string => p !== null))];
  const signed = new Map<string, string>();
  if (toSign.length) {
    const { data, error } = await admin.storage
      .from("plan-media")
      .createSignedUrls(toSign, LISTING_COVER_TTL_SECONDS);
    if (error) console.error("[marketplace] signing covers failed", error);
    for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
  }
  return media.map((url, i) => {
    if (url && isDefaultPlanMedia(url)) return url;
    const path = paths[i];
    return path ? (signed.get(path) ?? null) : null;
  });
}

const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v)$/i;

/** Whether a stored cover URL names a video file. */
export function isPlanMediaVideo(url: string): boolean {
  try {
    return VIDEO_EXTENSIONS.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** 422 unless `url` is a video in the folder of a plan this coach owns (no default artwork here). */
export async function assertPlanMediaVideoOwned(
  supabase: Client,
  coachId: string,
  url: string,
): Promise<void> {
  if (isDefaultPlanMedia(url) || !isPlanMediaVideo(url)) {
    throw new ApiError({
      code: "unprocessable",
      status: 422,
      message: "mediaVideo must be the URL of an MP4 or MOV uploaded to one of your plans in plan-media.",
    });
  }
  await assertPlanMediaOwned(supabase, coachId, url);
}

/**
 * Which cover the marketplace shows: the coach's own uploaded image, else their video, else
 * the stored media (default artwork or nothing).
 */
export function listingCover(
  media: string | null,
  mediaVideo: string | null,
): { kind: "image" | "video"; url: string } | null {
  if (media && !isDefaultPlanMedia(media)) return { kind: "image", url: media };
  if (mediaVideo) return { kind: "video", url: mediaVideo };
  return media ? { kind: "image", url: media } : null;
}

/** 422 unless `url` is default artwork or an image in the folder of a plan this coach owns. */
export async function assertPlanMediaOwned(
  supabase: Client,
  coachId: string,
  url: string,
): Promise<void> {
  if (isDefaultPlanMedia(url)) return;
  const folder = planMediaFolder(url);
  if (!folder) throw invalidMedia();
  const { data, error } = await supabase
    .from("plans")
    .select("id")
    .eq("id", folder)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw invalidMedia();
}

export type PlanProductType = z.infer<typeof planProductTypeInput>;

export type PlanMarketplaceFields = {
  price: number;
  media: string | null;
  mediaVideo: string | null;
  productType: PlanProductType | null;
  sport: string | null;
  selectedLevel: string | null;
  selectedLevelTo: string | null;
  description: string | null;
  weeks: number | null;
  sessionsPerWeek: number | null;
  lessonCount: number | null;
};

/** The fields a request may write; an absent one stays as it is. */
export type PlanMarketplaceInput = {
  price?: number;
  media?: string | null;
  /** null removes the cover video. */
  mediaVideo?: string | null;
  productType?: PlanProductType;
  sport?: string;
  selectedLevel?: string;
  /** The range's other end; null makes it a single level. */
  selectedLevelTo?: string | null;
  description?: string | null;
  /** Each of these: null clears it. */
  weeks?: number | null;
  sessionsPerWeek?: number | null;
  lessonCount?: number | null;
};

/** A plan's marketplace fields, or null when the caller can't read the plan. */
export async function getPlanMarketplaceFields(
  supabase: Client,
  planId: string,
): Promise<PlanMarketplaceFields | null> {
  const { data, error } = await untyped(supabase)
    .from("plans")
    .select(
      "price, media, media_video, product_type, sport, selected_level, selected_level_to, description, weeks, sessions_per_week, lesson_count",
    )
    .eq("id", planId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) return null;
  // PostgREST sends numeric as a number, or as a string past float precision.
  return {
    price: Number(data.price),
    media: data.media ?? null,
    mediaVideo: data.media_video ?? null,
    productType: data.product_type ?? null,
    sport: data.sport ?? null,
    selectedLevel: data.selected_level ?? null,
    selectedLevelTo: data.selected_level_to ?? null,
    description: data.description ?? null,
    weeks: data.weeks ?? null,
    sessionsPerWeek: data.sessions_per_week ?? null,
    lessonCount: data.lesson_count ?? null,
  };
}

/**
 * Writes the fields a request sent, after the plan row itself was written; an
 * absent field stays as it is. Separate from that typed write only until the
 * generated types know these columns.
 */
export async function setPlanMarketplaceFields(
  supabase: Client,
  planId: string,
  input: PlanMarketplaceInput,
): Promise<void> {
  const columns = {
    ...(input.price !== undefined ? { price: input.price } : {}),
    ...(input.media !== undefined ? { media: input.media } : {}),
    ...(input.mediaVideo !== undefined ? { media_video: input.mediaVideo } : {}),
    ...(input.productType !== undefined ? { product_type: input.productType } : {}),
    ...(input.sport !== undefined ? { sport: input.sport } : {}),
    ...(input.selectedLevel !== undefined ? { selected_level: input.selectedLevel } : {}),
    // A new level without a range end is a single level: the old end goes.
    ...(input.selectedLevelTo !== undefined
      ? { selected_level_to: input.selectedLevelTo }
      : input.selectedLevel !== undefined
        ? { selected_level_to: null }
        : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.weeks !== undefined ? { weeks: input.weeks } : {}),
    ...(input.sessionsPerWeek !== undefined ? { sessions_per_week: input.sessionsPerWeek } : {}),
    ...(input.lessonCount !== undefined ? { lesson_count: input.lessonCount } : {}),
  };
  if (Object.keys(columns).length === 0) return;
  const { error } = await untyped(supabase).from("plans").update(columns).eq("id", planId);
  if (error) dbError(error);
}

/**
 * What a copy of a plan (a clone, or the fork on reassigning an athlete) gets:
 * the fields the request sent, else its source's. The source's uploaded image
 * stays with it (it lives in that plan's plan-media folder); default artwork
 * carries over.
 */
export function marketplaceFieldsForCopy(
  source: PlanMarketplaceFields | null,
  sent: PlanMarketplaceInput,
): PlanMarketplaceInput {
  return {
    price: sent.price ?? source?.price,
    media:
      sent.media !== undefined
        ? sent.media
        : source?.media && isDefaultPlanMedia(source.media)
          ? source.media
          : undefined,
    // Like an uploaded image, the source's video stays in the source plan's folder.
    mediaVideo: sent.mediaVideo,
    productType: sent.productType ?? source?.productType ?? undefined,
    sport: sent.sport ?? source?.sport ?? undefined,
    selectedLevel: sent.selectedLevel ?? source?.selectedLevel ?? undefined,
    // The range travels with its first level: a level sent here brings its own end.
    selectedLevelTo:
      sent.selectedLevel !== undefined
        ? (sent.selectedLevelTo ?? null)
        : (source?.selectedLevelTo ?? undefined),
    description: sent.description !== undefined ? sent.description : source?.description,
    weeks: sent.weeks !== undefined ? sent.weeks : (source?.weeks ?? undefined),
    sessionsPerWeek:
      sent.sessionsPerWeek !== undefined
        ? sent.sessionsPerWeek
        : (source?.sessionsPerWeek ?? undefined),
    lessonCount:
      sent.lessonCount !== undefined ? sent.lessonCount : (source?.lessonCount ?? undefined),
  };
}
