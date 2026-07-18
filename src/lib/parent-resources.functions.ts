import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

export type ResourceKind = "pdf" | "image" | "link";
export type ResourceSource = "library" | "coach";

export interface ResourceDTO {
  id: string;
  sport: string;
  sports: string[];
  title: string;
  description: string;
  kind: ResourceKind;
  source: ResourceSource;
  externalUrl: string | null;
  coachName: string | null;
}

export interface ParentResourcesDTO {
  /** Distinct sports the parent has at least one athlete in. */
  sports: string[];
  resources: ResourceDTO[];
}

export const getParentResources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ParentResourcesDTO> => {
    const supabase = context.supabase as Client;

    const { data: parent, error: pErr } = await supabase
      .from("parent_profiles")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (pErr) dbError(pErr);
    if (!parent) return { sports: [], resources: [] };

    const { data: athleteRows, error: aErr } = await supabase
      .from("athletes")
      .select("id")
      .eq("parent_id", parent.id);
    if (aErr) dbError(aErr);
    const athleteIds = (athleteRows ?? []).map((a) => a.id);
    if (!athleteIds.length) return { sports: [], resources: [] };

    const { data: goalRows, error: gErr } = await supabase
      .from("athlete_goals")
      .select("sport")
      .in("athlete_id", athleteIds);
    if (gErr) dbError(gErr);

    const { data: coachSportRows, error: csErr } = await supabase
      .from("coach_athlete_sports")
      .select("sport")
      .in("athlete_id", athleteIds);
    if (csErr) dbError(csErr);

    const sports = Array.from(
      new Set([
        ...(goalRows ?? []).map((g) => g.sport),
        ...(coachSportRows ?? []).map((c) => c.sport),
      ]),
    ).sort();
    if (!sports.length) return { sports: [], resources: [] };

    // Library rows (coach_id IS NULL, published, sport in scope)
    const { data: libraryRows, error: rErr } = await supabase
      .from("resources")
      .select("id, sport, title, description, kind, external_url")
      .is("coach_id", null)
      .in("sport", sports)
      .eq("published", true)
      .order("display_order", { ascending: true })
      .order("title", { ascending: true });
    if (rErr) dbError(rErr);

    // Coach uploads — RLS restricts to rows the parent's roster is entitled to see.
    const { data: coachRows, error: cErr } = await supabase
      .from("resources")
      .select(
        "id, sport, title, description, kind, external_url, coach_id, coach_profiles!resources_coach_id_fkey(first_name, last_name), resource_sports(sport)",
      )
      .not("coach_id", "is", null)
      .order("created_at", { ascending: false });
    if (cErr) dbError(cErr);

    const library: ResourceDTO[] = (libraryRows ?? []).map((r) => ({
      id: r.id,
      sport: r.sport,
      sports: [r.sport],
      title: r.title,
      description: r.description ?? "",
      kind: (r.kind as ResourceKind) ?? "pdf",
      source: "library",
      externalUrl: r.external_url,
      coachName: null,
    }));

    const coach: ResourceDTO[] = (coachRows ?? []).map((r) => {
      const cp = r.coach_profiles as { first_name: string; last_name: string } | null;
      const tags = (r.resource_sports ?? []).map((s: { sport: string }) => s.sport);
      return {
        id: r.id,
        sport: r.sport,
        sports: tags.length ? tags : [r.sport],
        title: r.title,
        description: r.description ?? "",
        kind: (r.kind as ResourceKind) ?? "pdf",
        source: "coach",
        externalUrl: r.external_url,
        coachName: cp ? `${cp.first_name} ${cp.last_name}`.trim() : null,
      };
    });

    return { sports, resources: [...coach, ...library] };
  });

export const getResourceSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ resourceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }): Promise<{ url: string }> => {
    const supabase = context.supabase as Client;
    // RLS restricts visibility.
    const { data: row, error } = await supabase
      .from("resources")
      .select("storage_path, external_url, kind")
      .eq("id", data.resourceId)
      .maybeSingle();
    if (error) dbError(error);
    if (!row) throw new Error("Resource not found");

    if (row.kind === "link") {
      if (!row.external_url) throw new Error("Missing link URL");
      return { url: row.external_url };
    }

    if (!row.storage_path) throw new Error("Missing storage path");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("resource-pdfs")
      .createSignedUrl(row.storage_path, 60 * 5);
    if (sErr || !signed) throw new Error(sErr?.message ?? "Could not sign URL");
    return { url: signed.signedUrl };
  });
