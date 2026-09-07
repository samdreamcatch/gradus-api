import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { rethrowPlain } from "./api/errors";
import {
  getAthleteGoalsDashboard as getAthleteGoalsDashboardShared,
  longTermGoalInput,
  motivationInput,
  updateAthleteLongTermGoal as updateAthleteLongTermGoalShared,
  updateAthleteMotivation as updateAthleteMotivationShared,
} from "./athlete-goals.server";

export type { AthleteGoalsDashboardDTO } from "./athlete-goals.server";

type Client = SupabaseClient<Database>;

/*
 * Thin wrappers over src/lib/athlete-goals.server.ts, shared with the
 * `/api/v1/athlete/goals*` routes. Behavior and error messages are
 * unchanged: reads and writes go through the caller's RLS client.
 */

export const updateAthleteLongTermGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => longTermGoalInput.parse(d))
  .handler(async ({ data, context }) => {
    try {
      return await updateAthleteLongTermGoalShared(
        { userId: context.userId, supabase: context.supabase as Client },
        data,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const updateAthleteMotivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => motivationInput.parse(d))
  .handler(async ({ data, context }) => {
    try {
      return await updateAthleteMotivationShared(
        { userId: context.userId, supabase: context.supabase as Client },
        data,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const getAthleteGoalsDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      return await getAthleteGoalsDashboardShared({
        userId: context.userId,
        supabase: context.supabase as Client,
        admin: supabaseAdmin,
      });
    } catch (err) {
      rethrowPlain(err);
    }
  });
