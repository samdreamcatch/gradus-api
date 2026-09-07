import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { rethrowPlain } from "./api/errors";
import { getParentGoalsDashboard as getParentGoalsDashboardShared } from "./parent-goals.server";

export type { ParentGoalAthleteDTO, ParentGoalSportDTO } from "./parent-goals.server";

type Client = SupabaseClient<Database>;

/*
 * Thin wrapper over src/lib/parent-goals.server.ts, shared with
 * `GET /api/v1/parent/goals`. Behavior is unchanged: reads go through the
 * caller's RLS client with the admin client only for coach-only tables.
 */
export const getParentGoalsDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      return await getParentGoalsDashboardShared({
        userId: context.userId,
        supabase: context.supabase as Client,
        admin: supabaseAdmin,
      });
    } catch (err) {
      rethrowPlain(err);
    }
  });
