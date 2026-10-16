/**
 * An athlete's resource feed (PRD §7.9 "Resources and Ask Gradus"): the
 * Gradus library plus coach uploads for their sports. Single source of
 * truth for athlete-resources.functions.ts and the `GET /api/v1/resources`
 * dispatcher's athlete branch. Extracted without behavior changes.
 *
 * Shares `ResourceDTO`/`ResourceKind` with parent-resources.server.ts — the
 * same DTO shape serves both audiences, as it did pre-extraction.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import { canAskGradus } from "./athlete-age";
import {
  STORE_SAFE_RIGHTS,
  type ResourceDTO,
  type ResourceFeedOptions,
  type ResourceKind,
} from "./parent-resources.server";

type Client = SupabaseClient<Database>;

export type AthleteResourcesContext = { userId: string; supabase: Client };

export interface AthleteResourcesDTO {
  sports: string[];
  resources: ResourceDTO[];
  /**
   * Whether this athlete is eligible for Ask Gradus's athlete persona
   * (`canAskGradus` in `athlete-age.ts`: birthdate on file AND confirmed
   * 18+). Exposed so the client can hide the feature — advisory only:
   * `POST /api/v1/ask` re-derives eligibility itself from a fresh,
   * authoritative read rather than trusting this or anything else
   * client-supplied.
   */
  canAskGradus: boolean;
}

/** Club overrides and club items for the caller's clubs; the feed still loads if this fails. */
async function withClubLibrary<T extends import("./org-content.server").MergeableResource>(
  userId: string,
  orgIds: string[] | null,
  sports: string[],
  library: T[],
  make: (r: import("./org-content.server").MergeableResource) => T,
): Promise<T[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { mergeClubLibrary, resolveMembership } = await import("./org-content.server");
    const ids = orgIds ?? (await resolveMembership(supabaseAdmin, userId))?.orgIds ?? [];
    return await mergeClubLibrary(supabaseAdmin, ids, sports, library, make);
  } catch (err) {
    console.error("[resources] club merge failed", err);
    return library;
  }
}

export async function getAthleteResources(
  ctx: AthleteResourcesContext,
  options: ResourceFeedOptions = {},
): Promise<AthleteResourcesDTO> {
  const { supabase, userId } = ctx;

  const { data: athlete, error: aErr } = await supabase
    .from("athletes")
    .select("id, birthdate")
    .eq("user_id", userId)
    .maybeSingle();
  if (aErr) dbError(aErr);
  if (!athlete) return { sports: [], resources: [], canAskGradus: false };
  const eligibleForAskGradus = canAskGradus(athlete.birthdate as string | null);

  const { data: goalRows, error: gErr } = await supabase
    .from("athlete_goals")
    .select("sport")
    .eq("athlete_id", athlete.id);
  if (gErr) dbError(gErr);

  const { data: coachSportRows, error: csErr } = await supabase
    .from("coach_athlete_sports")
    .select("sport")
    .eq("athlete_id", athlete.id);
  if (csErr) dbError(csErr);

  const sports = Array.from(
    new Set([
      ...(goalRows ?? []).map((g) => g.sport),
      ...(coachSportRows ?? []).map((c) => c.sport),
    ]),
  ).sort();
  if (!sports.length) return { sports: [], resources: [], canAskGradus: eligibleForAskGradus };

  // Gradus library rows (coach_id IS NULL, published, sport in scope)
  let libraryQuery = supabase
    .from("resources")
    .select("id, sport, title, description, kind, external_url")
    .is("coach_id", null)
    .in("sport", sports)
    .eq("published", true);
  // See `ResourceFeedOptions`: the store app lists only rights-confirmed rows.
  if (options.storeSafeOnly) libraryQuery = libraryQuery.in("rights", [...STORE_SAFE_RIGHTS]);
  const { data: libraryRows, error: rErr } = await libraryQuery
    .order("display_order", { ascending: true })
    .order("title", { ascending: true });
  if (rErr) dbError(rErr);

  // Coach uploads — RLS restricts to rows this athlete is entitled to see.
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

  const merged = await withClubLibrary(userId, null, sports, library, (r) => ({
    ...r,
    sports: [r.sport],
    source: "library" as const,
    coachName: null,
  }));
  return { sports, resources: [...coach, ...merged], canAskGradus: eligibleForAskGradus };
}
