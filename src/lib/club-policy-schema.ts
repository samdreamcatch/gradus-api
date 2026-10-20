import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Additive draft tables mirror the existing row shapes. Generated types remain untouched.
type Tables = Database["public"]["Tables"];
type ClubPolicyDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Tables & {
      club_resource_ack_requirements: Tables["resource_ack_requirements"];
      club_resource_acknowledgements: Tables["resource_acknowledgements"];
    };
    Functions: Database["public"]["Functions"] & {
      set_club_policy_requirement: {
        Args: {
          p_org: string;
          p_resource: string;
          p_audiences: string[];
          p_again: boolean;
          p_actor: string;
        };
        Returns: number;
      };
    };
  };
};

export function policyClient(client: SupabaseClient<Database>): SupabaseClient<ClubPolicyDatabase> {
  return client as unknown as SupabaseClient<ClubPolicyDatabase>;
}
