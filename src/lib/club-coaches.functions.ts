import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import type { CoachWeek } from "./club-coach-metrics";

type CoachDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      org_coach_week_stats: { Row: CoachWeek & { organization_id: string }; Insert: never; Update: never; Relationships: [] };
    };
    Functions: Database["public"]["Functions"] & { refresh_club_coach_weeks: { Args: { p_org: string }; Returns: undefined } };
  };
};

export const getClubCoachWeeks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ organizationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const permission = await context.supabase.rpc("has_org_admin", { _user_id: context.userId, _org_id: data.organizationId });
    if (permission.error) dbError(permission.error);
    if (!permission.data) throw new Error("Not authorized for this club.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient<CoachDatabase>;
    // Recompute at most every 10 minutes; Home, Coaching and profiles all read this.
    const latest = await admin.from("org_coach_week_stats").select("computed_at")
      .eq("organization_id", data.organizationId).order("computed_at", { ascending: false }).limit(1);
    if (latest.error) dbError(latest.error);
    const last = latest.data?.[0]?.computed_at;
    if (!last || Date.now() - new Date(last).getTime() > 10 * 60_000) {
      const refresh = await admin.rpc("refresh_club_coach_weeks", { p_org: data.organizationId });
      if (refresh.error) dbError(refresh.error);
    }
    const result = await admin.from("org_coach_week_stats")
      .select("coach_id,week_start,students,minors,practice_min,target_min,sessions,computed_at")
      .eq("organization_id", data.organizationId).order("week_start", { ascending: false });
    if (result.error) dbError(result.error);
    return { viewerId: context.userId, weeks: result.data ?? [] };
  });