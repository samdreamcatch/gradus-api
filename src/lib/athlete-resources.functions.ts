import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import type { ResourceDTO, ResourceKind } from "./parent-resources.functions";

type Client = SupabaseClient<Database>;

export interface AthleteResourcesDTO {
  sports: string[];
  resources: ResourceDTO[];
}

export const getAthleteResources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AthleteResourcesDTO> => {
    const supabase = context.supabase as Client;

    const { data: athlete, error: aErr } = await supabase
      .from("athletes")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (aErr) dbError(aErr);
    if (!athlete) return { sports: [], resources: [] };

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
    if (!sports.length) return { sports: [], resources: [] };

    // Gradus library rows (coach_id IS NULL, published, sport in scope)
    const { data: libraryRows, error: rErr } = await supabase
      .from("resources")
      .select("id, sport, title, description, kind, external_url")
      .is("coach_id", null)
      .in("sport", sports)
      .eq("published", true)
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

    return { sports, resources: [...coach, ...library] };
  });
