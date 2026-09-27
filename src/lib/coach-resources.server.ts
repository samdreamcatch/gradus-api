/**
 * A coach's uploaded resources plus the read-only Gradus library for their
 * sports (PRD §7.9 "Resources and Ask Gradus"): list, create, delete, and
 * mint a signed upload URL for the private `resource-pdfs` bucket. Single
 * source of truth for coach-resources.functions.ts and the
 * `/api/v1/coach/resources*` routes. Extracted without behavior changes;
 * user-facing messages are kept verbatim on `ApiError`.
 *
 * The two storage operations (`createSignedUploadUrl`, `storage.remove`)
 * keep the original's dynamic `import("@/integrations/supabase/client.server")`
 * for `supabaseAdmin` rather than taking an admin client as a parameter —
 * unchanged from the pre-extraction code.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { STORE_SAFE_RIGHTS, type ResourceFeedOptions } from "./parent-resources.server";

type Client = SupabaseClient<Database>;

export type CoachResourcesContext = {
  userId: string;
  supabase: Client;
  /** Checks an image link is public before it is saved; tests pass a fake. */
  fetchImpl?: typeof fetch;
};

export type CoachResourceKind = "pdf" | "image" | "link";

export interface CoachResourceDTO {
  id: string;
  title: string;
  description: string;
  kind: CoachResourceKind;
  sports: string[];
  externalUrl: string | null;
  storagePath: string | null;
  createdAt: string;
}

export interface LibraryResourceDTO {
  id: string;
  sport: string;
  title: string;
  description: string;
  kind: CoachResourceKind;
  externalUrl: string | null;
}

export interface CoachResourcesDTO {
  /** Sports the coach teaches (from coach_levels). */
  sports: string[];
  resources: CoachResourceDTO[];
  libraryResources: LibraryResourceDTO[];
  canUpload: boolean;
  effectiveTier: "coach" | "coach_pro" | "club";
}

const wrongRole = (message: string) => new ApiError({ code: "wrong_role", status: 403, message });
const forbidden = (message: string) => new ApiError({ code: "forbidden", status: 403, message });
const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });
const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });

async function getCallerCoach(supabase: Client, userId: string) {
  const { data: coach, error } = await supabase
    .from("coach_profiles")
    .select("id, organization_id, subscription_tier")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  return coach;
}

function computeTier(coach: {
  organization_id: string | null;
  subscription_tier: string | null;
}): "coach" | "coach_pro" | "club" {
  if (coach.organization_id) return "club";
  if (coach.subscription_tier === "coach_pro") return "coach_pro";
  return "coach";
}

export async function listCoachResources(
  ctx: CoachResourcesContext,
  options: ResourceFeedOptions = {},
): Promise<CoachResourcesDTO> {
  const { supabase, userId } = ctx;
  const coach = await getCallerCoach(supabase, userId);
  if (!coach) {
    return {
      sports: [],
      resources: [],
      libraryResources: [],
      canUpload: false,
      effectiveTier: "coach",
    };
  }

  const tier = computeTier(coach);

  const { data: levelRows, error: lErr } = await supabase
    .from("coach_levels")
    .select("sport")
    .eq("coach_id", coach.id);
  if (lErr) dbError(lErr);
  const sports = Array.from(new Set((levelRows ?? []).map((l) => l.sport))).sort();

  const { data: rows, error: rErr } = await supabase
    .from("resources")
    .select(
      "id, title, description, kind, external_url, storage_path, created_at, resource_sports(sport)",
    )
    .eq("coach_id", coach.id)
    .order("created_at", { ascending: false });
  if (rErr) dbError(rErr);

  const resources: CoachResourceDTO[] = (rows ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description ?? "",
    kind: (r.kind as CoachResourceKind) ?? "pdf",
    sports: (r.resource_sports ?? []).map((s: { sport: string }) => s.sport),
    externalUrl: r.external_url,
    storagePath: r.storage_path,
    createdAt: r.created_at,
  }));

  let libraryResources: LibraryResourceDTO[] = [];
  if (sports.length) {
    let libraryQuery = supabase
      .from("resources")
      .select("id, sport, title, description, kind, external_url")
      .is("coach_id", null)
      .in("sport", sports)
      .eq("published", true);
    // See `ResourceFeedOptions`: the store app lists only rights-confirmed rows.
    if (options.storeSafeOnly) libraryQuery = libraryQuery.in("rights", [...STORE_SAFE_RIGHTS]);
    const { data: libRows, error: libErr } = await libraryQuery
      .order("display_order", { ascending: true })
      .order("title", { ascending: true });
    if (libErr) dbError(libErr);
    libraryResources = (libRows ?? []).map((r) => ({
      id: r.id,
      sport: r.sport,
      title: r.title,
      description: r.description ?? "",
      kind: (r.kind as CoachResourceKind) ?? "pdf",
      externalUrl: r.external_url,
    }));
  }

  return {
    sports,
    resources,
    libraryResources,
    canUpload: tier === "coach_pro" || tier === "club",
    effectiveTier: tier,
  };
}

export const IMAGE_UPLOAD_REFUSED =
  "Images can't be uploaded from your device. Add a link to an image that's publicly available on the web.";

const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://"), "Link must use https://");

/**
 * A coach adds images (and videos, as links) only from a publicly available
 * web address, never from their device: file uploads are PDF only. Keeps
 * photos from a coach's camera roll, which may show minors, out of Gradus.
 */
export const createCoachResourceInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(600).optional().default(""),
    kind: z.enum(["pdf", "image", "link"]),
    sports: z.array(z.string().min(1)).min(1).max(10),
    storagePath: z.string().min(1).nullable().optional(),
    externalUrl: httpsUrl.nullable().optional(),
  })
  .refine(
    (v) =>
      v.kind === "pdf"
        ? !!v.storagePath && !v.externalUrl
        : v.kind === "link"
          ? !!v.externalUrl && !v.storagePath
          : // An image upload passes the shape check so the handler can refuse it in words.
            !!v.externalUrl !== !!v.storagePath,
    { message: "kind and payload mismatch" },
  );

const PUBLIC_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
]);

const NOT_A_PUBLIC_IMAGE =
  "That link isn't a publicly available image. Paste a direct https link to a JPG, PNG, GIF, or WebP that opens without signing in.";

/** Loopback, private, link-local, and unique-local hosts: never "publicly available". */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (h.includes(":")) {
    return (
      h === "::" ||
      h === "::1" ||
      /^f[cd]/.test(h) ||
      /^fe[89ab]/.test(h) ||
      h.startsWith("::ffff:")
    );
  }
  return false;
}

/**
 * Confirms `url` serves an image to an anonymous request: https, no
 * credentials in the URL, not a private host, and a 2xx answer whose
 * content type is a raster image. A share page (Google Photos, iCloud) or
 * anything behind a sign-in answers HTML or 401/403 and is refused.
 */
export async function assertPublicImageUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw unprocessable(NOT_A_PUBLIC_IMAGE);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw unprocessable(NOT_A_PUBLIC_IMAGE);
  }
  if (isPrivateHost(parsed.hostname)) throw unprocessable(NOT_A_PUBLIC_IMAGE);

  const probe = async (method: "HEAD" | "GET") => {
    const res = await fetchImpl(parsed.toString(), {
      method,
      redirect: "follow",
      // Some hosts (Wikimedia, for one) refuse requests with no User-Agent.
      headers: {
        "User-Agent": "GradusLinkCheck/1.0 (+https://gradus.training)",
        ...(method === "GET" ? { Range: "bytes=0-0" } : {}),
      },
      signal: AbortSignal.timeout(8000),
    });
    // Only the headers matter; don't download the body.
    await res.body?.cancel().catch(() => {});
    return res;
  };

  let res: Response;
  try {
    res = await probe("HEAD");
    // Some hosts refuse HEAD; ask for the first byte instead.
    if (!res.ok) res = await probe("GET");
  } catch {
    throw unprocessable(
      "We couldn't reach that image link. Check it opens in a private browser window, then try again.",
    );
  }
  if (res.url && isPrivateHost(new URL(res.url).hostname)) throw unprocessable(NOT_A_PUBLIC_IMAGE);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!res.ok || !PUBLIC_IMAGE_TYPES.has(type)) throw unprocessable(NOT_A_PUBLIC_IMAGE);
}

export async function createCoachResource(
  ctx: CoachResourcesContext,
  data: z.infer<typeof createCoachResourceInput>,
): Promise<{ id: string }> {
  const { supabase, userId } = ctx;
  const coach = await getCallerCoach(supabase, userId);
  if (!coach) throw wrongRole("Coach profile not found");
  const tier = computeTier(coach);
  if (tier === "coach") {
    throw forbidden("Coach Pro or Club plan required to upload resources");
  }

  // Validate sports subset of coach_levels
  const { data: levelRows, error: lErr } = await supabase
    .from("coach_levels")
    .select("sport")
    .eq("coach_id", coach.id);
  if (lErr) dbError(lErr);
  const allowed = new Set((levelRows ?? []).map((l) => l.sport));
  for (const s of data.sports) {
    if (!allowed.has(s)) throw unprocessable(`You don't coach ${s}`);
  }

  if (data.kind === "image") {
    if (data.storagePath || !data.externalUrl) throw unprocessable(IMAGE_UPLOAD_REFUSED);
    await assertPublicImageUrl(data.externalUrl, ctx.fetchImpl);
  }
  // A PDF must be one this coach uploaded: their own folder, a .pdf name.
  if (
    data.storagePath &&
    (!data.storagePath.startsWith(`coach/${coach.id}/`) ||
      !data.storagePath.toLowerCase().endsWith(".pdf") ||
      data.storagePath.includes(".."))
  ) {
    throw unprocessable(PDF_ONLY);
  }

  const { data: inserted, error: iErr } = await supabase
    .from("resources")
    .insert({
      coach_id: coach.id,
      kind: data.kind,
      title: data.title,
      description: data.description ?? "",
      sport: data.sports[0],
      storage_path: data.storagePath ?? null,
      external_url: data.externalUrl ?? null,
      published: true,
      display_order: 0,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (iErr) dbError(iErr);
  if (!inserted) throw new Error("Insert failed");

  const tagRows = data.sports.map((s) => ({ resource_id: inserted.id, sport: s }));
  const { error: tErr } = await supabase.from("resource_sports").insert(tagRows);
  if (tErr) {
    // Rollback the resource row so we don't strand it without tags.
    await supabase.from("resources").delete().eq("id", inserted.id);
    dbError(tErr);
  }

  // A coach's PDF joins the knowledge corpus scoped to that coach (PRD §6.7
  // "Grounded Ask Gradus": retrievable only for their athletes and guardians).
  // Best-effort: the upload never fails because the corpus did.
  if (data.kind === "pdf" && data.storagePath) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { registerKnowledgeSource } = await import("./knowledge-ingest.server");
      await registerKnowledgeSource(
        supabaseAdmin as unknown as Parameters<typeof registerKnowledgeSource>[0],
        {
          title: data.title,
          publisher: "Coach upload",
          sport: "all",
          coachId: coach.id,
          resourceId: inserted.id,
          kind: "pdf",
          storagePath: data.storagePath,
          chunker: "prose",
          rightsBasis: "coach_upload",
          quoteAllowed: true,
          createdBy: userId,
        },
      );
    } catch (err) {
      console.error("[coach-resources] knowledge registration failed", err);
    }
  }

  return { id: inserted.id };
}

export async function deleteCoachResource(
  ctx: CoachResourcesContext,
  id: string,
): Promise<{ ok: true }> {
  const { supabase, userId } = ctx;
  const coach = await getCallerCoach(supabase, userId);
  if (!coach) throw wrongRole("Coach profile not found");

  // Fetch to find storage_path before delete
  const { data: row, error: rErr } = await supabase
    .from("resources")
    .select("storage_path, coach_id")
    .eq("id", id)
    .maybeSingle();
  if (rErr) dbError(rErr);
  if (!row || row.coach_id !== coach.id) throw notFound("Not found");

  const { error: dErr } = await supabase.from("resources").delete().eq("id", id);
  if (dErr) dbError(dErr);

  if (row.storage_path) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.storage.from("resource-pdfs").remove([row.storage_path]);
  }
  return { ok: true };
}

export const PDF_ONLY =
  "Only PDFs can be uploaded. Add images and videos as a link to a public web address.";

export const createCoachResourceUploadUrlInput = z.object({
  ext: z
    .string()
    .regex(/^[a-z0-9]{1,8}$/i, "Invalid extension")
    .transform((s) => s.toLowerCase()),
  contentType: z.string().min(3).max(120),
});

export async function createCoachResourceUploadUrl(
  ctx: CoachResourcesContext,
  data: z.infer<typeof createCoachResourceUploadUrlInput>,
): Promise<{ path: string; token: string; url: string }> {
  const { supabase, userId } = ctx;
  const coach = await getCallerCoach(supabase, userId);
  if (!coach) throw wrongRole("Coach profile not found");
  const tier = computeTier(coach);
  if (tier === "coach") {
    throw forbidden("Coach Pro or Club plan required to upload resources");
  }

  // File uploads are PDF only; images and videos come in as public links.
  const contentType = data.contentType.split(";")[0].trim().toLowerCase();
  if (data.ext !== "pdf" || contentType !== "application/pdf") throw unprocessable(PDF_ONLY);

  const uuid = crypto.randomUUID();
  const path = `coach/${coach.id}/${uuid}.${data.ext}`;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: signed, error } = await supabaseAdmin.storage
    .from("resource-pdfs")
    .createSignedUploadUrl(path);
  if (error || !signed) throw unprocessable(error?.message ?? "Could not sign upload");
  return { path, token: signed.token, url: signed.signedUrl };
}
