import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

export interface AthleteResourcesDTO {
  sports: string[];
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
    if (!athlete) return { sports: [] };

    const { data: goalRows, error: gErr } = await supabase
      .from("athlete_goals")
      .select("sport")
      .eq("athlete_id", athlete.id);
    if (gErr) dbError(gErr);

    const sports = Array.from(
      new Set((goalRows ?? []).map((g) => g.sport)),
    ).sort();
    return { sports };
  });
