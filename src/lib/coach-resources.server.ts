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

export type CoachResourcesContext = { userId: string; supabase: Client };

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

export const createCoachResourceInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(600).optional().default(""),
    kind: z.enum(["pdf", "image", "link"]),
    sports: z.array(z.string().min(1)).min(1).max(10),
    storagePath: z.string().min(1).nullable().optional(),
    externalUrl: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://"), "Link must use https://")
      .nullable()
      .optional(),
  })
  .refine(
    (v) =>
      v.kind === "link" ? !!v.externalUrl && !v.storagePath : !!v.storagePath && !v.externalUrl,
    { message: "kind and payload mismatch" },
  );

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

  const uuid = crypto.randomUUID();
  const path = `coach/${coach.id}/${uuid}.${data.ext}`;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: signed, error } = await supabaseAdmin.storage
    .from("resource-pdfs")
    .createSignedUploadUrl(path);
  if (error || !signed) throw unprocessable(error?.message ?? "Could not sign upload");
  return { path, token: signed.token, url: signed.signedUrl };
}
