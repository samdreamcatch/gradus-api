/**
 * The marketplace fields on a plan (migration 20261103120000_plans_price_media):
 * `price`, in USD with 0 as free, and `media`, the plan's one image as the
 * authenticated Supabase Storage URL of an object in the private `plan-media`
 * bucket (`<SUPABASE_URL>/storage/v1/object/authenticated/plan-media/<plan id>/<file>`).
 * The plan create, save and patch routes write them; the coach's plan detail
 * reads them back.
 *
 * `plans.price` and `plans.media` aren't in the generated types until Lovable
 * regenerates them, so they're read and written through `untyped`.
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

export const PLAN_MEDIA_PATH = "/storage/v1/object/authenticated/plan-media/";

const invalidMedia = () =>
  new ApiError({
    code: "unprocessable",
    status: 422,
    message: "media must be the URL of an image uploaded to one of your plans in plan-media.",
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
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (supabaseUrl && parsed.origin !== new URL(supabaseUrl).origin) return null;
  if (!parsed.pathname.startsWith(PLAN_MEDIA_PATH)) return null;
  const [folder, ...file] = decodeURIComponent(parsed.pathname.slice(PLAN_MEDIA_PATH.length)).split(
    "/",
  );
  if (!file.join("/")) return null;
  return z.string().uuid().safeParse(folder).success ? folder : null;
}

/** 422 unless `url` is an image in the folder of a plan this coach owns. */
export async function assertPlanMediaOwned(
  supabase: Client,
  coachId: string,
  url: string,
): Promise<void> {
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

export type PlanMarketplaceFields = { price: number; media: string | null };

/** A plan's price and image, or null when the caller can't read the plan. */
export async function getPlanMarketplaceFields(
  supabase: Client,
  planId: string,
): Promise<PlanMarketplaceFields | null> {
  const { data, error } = await untyped(supabase)
    .from("plans")
    .select("price, media")
    .eq("id", planId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) return null;
  // PostgREST sends numeric as a number, or as a string past float precision.
  return { price: Number(data.price), media: data.media ?? null };
}

/**
 * Writes the fields a request sent, after the plan row itself was written; an
 * absent field stays as it is. Separate from that typed write only until the
 * generated types know these columns.
 */
export async function setPlanMarketplaceFields(
  supabase: Client,
  planId: string,
  input: { price?: number; media?: string | null },
): Promise<void> {
  const columns = {
    ...(input.price !== undefined ? { price: input.price } : {}),
    ...(input.media !== undefined ? { media: input.media } : {}),
  };
  if (Object.keys(columns).length === 0) return;
  const { error } = await untyped(supabase).from("plans").update(columns).eq("id", planId);
  if (error) dbError(error);
}
