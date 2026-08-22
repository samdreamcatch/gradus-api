import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

export type WrapUpClient = SupabaseClient<Database>;

export async function getCoachIdOrNull(
  supabase: WrapUpClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  return data?.id ?? null;
}
