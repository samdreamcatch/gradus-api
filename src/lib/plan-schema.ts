import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

type SharingFields = {
  shared_from_id: string | null;
  shared_synced: Json | null;
  shared_changes: Json | null;
};
type PlanTable = Database["public"]["Tables"]["plans"];
type PlanDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Omit<Database["public"]["Tables"], "plans"> & {
      plans: Omit<PlanTable, "Row" | "Insert" | "Update"> & {
        Row: PlanTable["Row"] & SharingFields;
        Insert: PlanTable["Insert"] & Partial<SharingFields>;
        Update: PlanTable["Update"] & Partial<SharingFields>;
      };
    };
  };
};

// Local schema extension for the plan-copy migration; preserves the caller's RLS client.
export function plansTable(client: SupabaseClient<Database>) {
  return (client as unknown as SupabaseClient<PlanDatabase>).from("plans");
}