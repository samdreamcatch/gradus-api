/**
 * A parent's resource feed (PRD §7.9 "Resources and Ask Gradus"): the
 * Gradus library plus coach uploads for the sports their athletes are in,
 * and a signed URL to view one. Single source of truth for
 * parent-resources.functions.ts and the `/api/v1/resources*` routes.
 * Extracted without behavior changes; user-facing messages are kept
 * verbatim on `ApiError`.
 *
 * `getResourceSignedUrl`'s storage lookup keeps the original's dynamic
 * `import("@/integrations/supabase/client.server")` for `supabaseAdmin`
 * rather than taking an admin client as a parameter — unchanged from the
 * pre-extraction code.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;
type Admin = typeof supabaseAdmin;

export type ParentResourcesContext = { userId: string; supabase: Client };

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
  /**
   * Always `true` at runtime: a parent account is always an adult. Typed as
   * `boolean` (not the literal `true`) to stay symmetric with
   * `AthleteResourcesDTO.canAskGradus` (athlete-resources.server.ts) — the
   * same DTO shape serves both audiences, per this file's doc comment
   * above, so both need the identical field shape even though a parent's
   * value never varies.
   */
  canAskGradus: boolean;
}

const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });
const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });

/**
 * `storeSafeOnly` (the iOS feed): curated library rows are listed only when
 * their `rights` is confirmed (`gradus` or `licensed`), never `pending`.
 * The web passes nothing and keeps showing every published row. Coach
 * uploads are unaffected either way.
 */
export type ResourceFeedOptions = { storeSafeOnly?: boolean };

export const STORE_SAFE_RIGHTS = ["gradus", "licensed"] as const;

export async function getParentResources(
  ctx: ParentResourcesContext & { admin: Admin },
  options: ResourceFeedOptions = {},
): Promise<ParentResourcesDTO> {
  const { supabase, admin, userId } = ctx;

  const { data: parent, error: pErr } = await supabase
    .from("parent_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (pErr) dbError(pErr);
  if (!parent) return { sports: [], resources: [], canAskGradus: true };

  // The plan-active check inside guardianAthleteAccess reads another
  // parent's parent_profiles row (the primary's), which RLS only allows for
  // that parent's own auth.uid() — so this one lookup goes through the admin
  // client even though the rest of this function stays on the caller's RLS
  // client. A locked athlete's sports/resources are hard-filtered out —
  // there's no per-athlete entry in this feed to redact instead.
  const { guardianAthleteAccess } = await import("./team.server");
  const access = await guardianAthleteAccess(admin as any, parent.id);
  const athleteIds = access.filter((a) => !a.locked).map((a) => a.athleteId);
  if (!athleteIds.length) return { sports: [], resources: [], canAskGradus: true };

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
  if (!sports.length) return { sports: [], resources: [], canAskGradus: true };

  // Library rows (coach_id IS NULL, published, sport in scope)
  let libraryQuery = supabase
    .from("resources")
    .select("id, sport, title, description, kind, external_url")
    .is("coach_id", null)
    .in("sport", sports)
    .eq("published", true);
  if (options.storeSafeOnly) libraryQuery = libraryQuery.in("rights", [...STORE_SAFE_RIGHTS]);
  const { data: libraryRows, error: rErr } = await libraryQuery
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

  return { sports, resources: [...coach, ...library], canAskGradus: true };
}

export async function getResourceSignedUrl(
  ctx: ParentResourcesContext,
  resourceId: string,
): Promise<{ url: string }> {
  const { supabase } = ctx;
  // RLS restricts visibility.
  const { data: row, error } = await supabase
    .from("resources")
    .select("storage_path, external_url, kind")
    .eq("id", resourceId)
    .maybeSingle();
  if (error) dbError(error);
  if (!row) throw notFound("Resource not found");

  if (row.kind === "link") {
    if (!row.external_url) throw unprocessable("Missing link URL");
    return { url: row.external_url };
  }

  if (!row.storage_path) throw unprocessable("Missing storage path");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: signed, error: sErr } = await supabaseAdmin.storage
    .from("resource-pdfs")
    .createSignedUrl(row.storage_path, 60 * 5);
  if (sErr || !signed) throw unprocessable(sErr?.message ?? "Could not sign URL");
  return { url: signed.signedUrl };
}
