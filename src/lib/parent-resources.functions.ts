import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

export interface ResourceDTO {
  id: string;
  sport: string;
  title: string;
  description: string;
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
    const sports = Array.from(new Set((goalRows ?? []).map((g) => g.sport))).sort();
    if (!sports.length) return { sports: [], resources: [] };

    const { data: rsrcRows, error: rErr } = await supabase
      .from("resources")
      .select("id, sport, title, description")
      .in("sport", sports)
      .eq("published", true)
      .order("display_order", { ascending: true })
      .order("title", { ascending: true });
    if (rErr) dbError(rErr);

    return {
      sports,
      resources: (rsrcRows ?? []).map((r) => ({
        id: r.id,
        sport: r.sport,
        title: r.title,
        description: r.description ?? "",
      })),
    };
  });

export const getResourceSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ resourceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }): Promise<{ url: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = context.supabase as Client;
    // RLS already restricts visibility to the parent's sports.
    const { data: row, error } = await supabase
      .from("resources")
      .select("storage_path")
      .eq("id", data.resourceId)
      .maybeSingle();
    if (error) dbError(error);
    if (!row) throw new Error("Resource not found");

    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("resource-pdfs")
      .createSignedUrl(row.storage_path, 60 * 5);
    if (sErr || !signed) throw new Error(sErr?.message ?? "Could not sign URL");
    return { url: signed.signedUrl };
  });
