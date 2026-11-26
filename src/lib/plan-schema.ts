import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

type SharingFields = {
  shared_from_id: string | null;
  shared_synced: Json | null;
  shared_changes: Json | null;
  /** Delete replaces Bench (decision #67): when the plan was deleted; kept by a database trigger. */
  deleted_at: string | null;
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

// Local schema extension for the plan-copy and delete-replaces-bench migrations; preserves
// the caller's RLS client. The generated types gain these columns once the migrations are
// applied and the types are regenerated; until then every read or write of them goes
// through here, so the generated file never has to be edited by hand.
export function plansTable(client: SupabaseClient<Database>) {
  return (client as unknown as SupabaseClient<PlanDatabase>).from("plans");
}

/** What a session keeps of its plan once the plan is removed (decision #67). */
type KeptPlanFields = { plan_title: string | null; plan_coach_id: string | null };
type SessionTable = Database["public"]["Tables"]["plan_sessions"];
type SessionDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Omit<Database["public"]["Tables"], "plan_sessions"> & {
      plan_sessions: Omit<SessionTable, "Row" | "Insert" | "Update"> & {
        Row: SessionTable["Row"] & KeptPlanFields;
        Insert: SessionTable["Insert"] & Partial<KeptPlanFields>;
        Update: SessionTable["Update"] & Partial<KeptPlanFields>;
      };
    };
  };
};

export function planSessionsTable(client: SupabaseClient<Database>) {
  return (client as unknown as SupabaseClient<SessionDatabase>).from("plan_sessions");
}
