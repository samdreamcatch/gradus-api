import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

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

export const listCoachResources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CoachResourcesDTO> => {
    const supabase = context.supabase as Client;
    const coach = await getCallerCoach(supabase, context.userId);
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
      const { data: libRows, error: libErr } = await supabase
        .from("resources")
        .select("id, sport, title, description, kind, external_url")
        .is("coach_id", null)
        .in("sport", sports)
        .eq("published", true)
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
  });

const CreateInput = z
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

export const createCoachResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CreateInput.parse(input))
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    const supabase = context.supabase as Client;
    const coach = await getCallerCoach(supabase, context.userId);
    if (!coach) throw new Error("Coach profile not found");
    const tier = computeTier(coach);
    if (tier === "coach") {
      throw new Error("Coach Pro or Club plan required to upload resources");
    }

    // Validate sports subset of coach_levels
    const { data: levelRows, error: lErr } = await supabase
      .from("coach_levels")
      .select("sport")
      .eq("coach_id", coach.id);
    if (lErr) dbError(lErr);
    const allowed = new Set((levelRows ?? []).map((l) => l.sport));
    for (const s of data.sports) {
      if (!allowed.has(s)) throw new Error(`You don't coach ${s}`);
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
        updated_by: context.userId,
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

    return { id: inserted.id };
  });

export const deleteCoachResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const supabase = context.supabase as Client;
    const coach = await getCallerCoach(supabase, context.userId);
    if (!coach) throw new Error("Coach profile not found");

    // Fetch to find storage_path before delete
    const { data: row, error: rErr } = await supabase
      .from("resources")
      .select("storage_path, coach_id")
      .eq("id", data.id)
      .maybeSingle();
    if (rErr) dbError(rErr);
    if (!row || row.coach_id !== coach.id) throw new Error("Not found");

    const { error: dErr } = await supabase.from("resources").delete().eq("id", data.id);
    if (dErr) dbError(dErr);

    if (row.storage_path) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.storage.from("resource-pdfs").remove([row.storage_path]);
    }
    return { ok: true };
  });

const UploadUrlInput = z.object({
  ext: z
    .string()
    .regex(/^[a-z0-9]{1,8}$/i, "Invalid extension")
    .transform((s) => s.toLowerCase()),
  contentType: z.string().min(3).max(120),
});

export const createCoachResourceUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => UploadUrlInput.parse(input))
  .handler(async ({ context, data }): Promise<{ path: string; token: string; url: string }> => {
    const supabase = context.supabase as Client;
    const coach = await getCallerCoach(supabase, context.userId);
    if (!coach) throw new Error("Coach profile not found");
    const tier = computeTier(coach);
    if (tier === "coach") {
      throw new Error("Coach Pro or Club plan required to upload resources");
    }

    const uuid = crypto.randomUUID();
    const path = `coach/${coach.id}/${uuid}.${data.ext}`;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("resource-pdfs")
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Could not sign upload");
    return { path, token: signed.token, url: signed.signedUrl };
  });
