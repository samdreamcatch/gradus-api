import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getCoachRoster as getCoachRosterShared } from "./coach-roster.server";

export type {
  CoachRoster,
  RosterAthlete,
  RosterClaimStatus,
  RosterSlot,
  SlotOverride,
} from "./coach-roster.server";

/*
 * Thin wrapper over src/lib/coach-roster.server.ts, shared with
 * `GET /api/v1/coach/roster`. Behavior is unchanged.
 */
export const getCoachRoster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return getCoachRosterShared({ userId: context.userId, admin: supabaseAdmin });
  });
