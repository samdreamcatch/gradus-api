/**
 * A coach's profile photo (migration 20261111120600_coach_profiles_photo).
 *
 * The app uploads the image straight to the private `coach-photos` bucket with
 * the coach's own token (the bucket's policies admit only the coach, under
 * `<coach id>/…`), then saves its authenticated URL with
 * `PUT /api/v1/coach/profile/photo`. Readers never get that URL: the
 * marketplace hands out a signed link to it, and only for a path inside the
 * coach's own folder.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Untyped = { from: (table: "coach_profiles") => any; rpc: (fn: string, args: object) => any };
const untyped = (client: Client) => client as unknown as Untyped;

export const COACH_PHOTOS_BUCKET = "coach-photos";
export const COACH_PHOTO_PATH = `/storage/v1/object/authenticated/${COACH_PHOTOS_BUCKET}/`;
/** How long a profile photo link works, like a listing's cover. */
export const COACH_PHOTO_TTL_SECONDS = 60 * 60;

/** `PUT /api/v1/coach/profile/photo`: the uploaded photo's URL, or null to remove it. */
export const setCoachPhotoInput = z.object({
  photo: z.string().url().max(2048).nullable(),
});

const invalidPhoto = () =>
  new ApiError({
    code: "unprocessable",
    status: 422,
    message: "photo must be the URL of an image uploaded to your own folder in coach-photos.",
  });

/**
 * The object's path in coach-photos (`<coach id>/<file>`) for an authenticated
 * URL from this project, or null: another host, another bucket, the public or
 * signed form, or no file under the folder.
 */
export function coachPhotoObjectPath(
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
  if (!parsed.pathname.startsWith(COACH_PHOTO_PATH)) return null;
  const path = decodeURIComponent(parsed.pathname.slice(COACH_PHOTO_PATH.length));
  const [folder, ...file] = path.split("/");
  if (!file.join("/")) return null;
  return z.string().uuid().safeParse(folder).success ? path : null;
}

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number,
      ) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;
    };
  };
};

/**
 * A link anyone browsing can load for `coachId`'s stored photo, or null: no
 * photo, a URL outside their own folder, or signing failed (never an error).
 */
export async function signedCoachPhotoUrl(
  admin: StorageClient,
  coachId: string,
  stored: string | null,
): Promise<string | null> {
  const path = stored ? coachPhotoObjectPath(stored) : null;
  if (!path || path.split("/")[0] !== coachId) return null;
  const { data, error } = await admin.storage
    .from(COACH_PHOTOS_BUCKET)
    .createSignedUrl(path, COACH_PHOTO_TTL_SECONDS);
  if (error) {
    console.error("[coach-photo] signing failed", error);
    return null;
  }
  return data?.signedUrl ?? null;
}

type BatchStorageClient = {
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
 * `signedCoachPhotoUrl` for a page of coaches in one signing call: coach id →
 * link, for those with a photo in their own folder. A failure leaves them out
 * (initials show), never the page.
 */
export async function signedCoachPhotoUrls(
  admin: BatchStorageClient,
  coaches: { id: string; photoUrl: string | null }[],
): Promise<Map<string, string>> {
  const pathByCoach = new Map<string, string>();
  for (const c of coaches) {
    const path = c.photoUrl ? coachPhotoObjectPath(c.photoUrl) : null;
    if (path && path.split("/")[0] === c.id) pathByCoach.set(c.id, path);
  }
  const links = new Map<string, string>();
  if (pathByCoach.size === 0) return links;
  const { data, error } = await admin.storage
    .from(COACH_PHOTOS_BUCKET)
    .createSignedUrls([...new Set(pathByCoach.values())], COACH_PHOTO_TTL_SECONDS);
  if (error) console.error("[coach-photo] signing failed", error);
  const byPath = new Map<string, string>();
  for (const s of data ?? []) if (s.path && s.signedUrl) byPath.set(s.path, s.signedUrl);
  for (const [coachId, path] of pathByCoach) {
    const link = byPath.get(path);
    if (link) links.set(coachId, link);
  }
  return links;
}

export type CoachPhotoContext = { userId: string; supabase: Client; admin: StorageClient };

/**
 * Sets (or with null, removes) the caller's profile photo, and ticks "Add
 * profile photo" on their setup checklist when one is set. Returns a link to
 * show it right away.
 */
export async function setCoachPhoto(
  ctx: CoachPhotoContext,
  photo: string | null,
): Promise<{ photoUrl: string | null }> {
  const { data: coach, error } = await ctx.supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!coach) {
    throw new ApiError({ code: "not_found", status: 404, message: "Coach profile not found." });
  }
  if (photo !== null && coachPhotoObjectPath(photo)?.split("/")[0] !== coach.id) {
    throw invalidPhoto();
  }

  const update = await untyped(ctx.supabase)
    .from("coach_profiles")
    .update({ photo_url: photo })
    .eq("id", coach.id);
  if (update.error) dbError(update.error);

  if (photo !== null) {
    const checklist = await untyped(ctx.supabase).rpc("merge_coach_checklist", {
      _patch: { uploadProfilePhoto: true },
    });
    // The photo is saved either way; the checklist tick is a nicety.
    if (checklist.error) console.error("[coach-photo] checklist update failed", checklist.error);
  }

  return { photoUrl: await signedCoachPhotoUrl(ctx.admin, coach.id, photo) };
}
