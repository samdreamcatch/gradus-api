import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import type { SessionsByState } from "@/components/plans/flow-state-bars";

type Client = SupabaseClient<Database>;

// state_index → SessionsByState key. Must match parent feedback modal order.
const STATE_KEYS = [
  "frustrated",
  "pushing",
  "steady",
  "lockedIn",
  "flowing",
] as const satisfies readonly (keyof SessionsByState)[];

export function emptySessionsByState(): SessionsByState {
  return { frustrated: 0, pushing: 0, steady: 0, lockedIn: 0, flowing: 0 };
}

/**
 * Load real session counts for a set of plan ids. Works for both parents
 * and coaches: RLS on plan_sessions restricts what each role can read.
 */
export async function loadSessionsByPlanIds(
  supabase: Client,
  planIds: string[],
): Promise<Map<string, { sessionsByState: SessionsByState; sessionsTotal: number }>> {
  const map = new Map<string, { sessionsByState: SessionsByState; sessionsTotal: number }>();
  for (const id of planIds) {
    map.set(id, { sessionsByState: emptySessionsByState(), sessionsTotal: 0 });
  }
  if (planIds.length === 0) return map;

  const { data, error } = await supabase
    .from("plan_sessions")
    .select("plan_id, state_index")
    .in("plan_id", planIds);
  if (error) dbError(error);

  for (const row of data ?? []) {
    const entry = map.get(row.plan_id);
    if (!entry) continue;
    const key = STATE_KEYS[row.state_index];
    if (!key) continue;
    entry.sessionsByState[key] += 1;
    entry.sessionsTotal += 1;
  }
  return map;
}

/** Coach + parent detail: counts for a single plan. */
export const getPlanSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const result = await loadSessionsByPlanIds(supabase, [data.planId]);
    const entry = result.get(data.planId) ?? {
      sessionsByState: emptySessionsByState(),
      sessionsTotal: 0,
    };
    return entry;
  });

/** Parent-only: submit a session from the feedback modal. */
export const submitPlanSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        planId: z.string().uuid(),
        stateIndex: z.number().int().min(0).max(4),
        note: z.string().max(2000).default(""),
        durationSeconds: z.number().int().min(0).max(86_400).default(0),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;

    console.info("[submitPlanSession] start", {
      userId: context.userId,
      planId: data.planId,
      stateIndex: data.stateIndex,
      durationSeconds: data.durationSeconds,
    });

    // Look up plan → athlete; parent_id comes from the caller's parent_profile.
    const [{ data: plan, error: pErr }, { data: parent, error: ppErr }] = await Promise.all([
      supabase
        .from("plans")
        .select("id, athlete_id")
        .eq("id", data.planId)
        .maybeSingle(),
      supabase
        .from("parent_profiles")
        .select("id")
        .eq("user_id", context.userId)
        .maybeSingle(),
    ]);
    if (pErr) {
      console.error("[submitPlanSession] plan lookup failed", pErr);
      dbError(pErr);
    }
    if (ppErr) {
      console.error("[submitPlanSession] parent lookup failed", ppErr);
      dbError(ppErr);
    }
    if (!plan?.athlete_id) {
      console.error("[submitPlanSession] plan not found or has no athlete", { planId: data.planId, plan });
      throw new Error("Plan not found");
    }
    if (!parent) {
      console.error("[submitPlanSession] parent_profiles row not found for user", { userId: context.userId });
      throw new Error("Parent profile not found");
    }

    console.info("[submitPlanSession] resolved", {
      parentId: parent.id,
      athleteId: plan.athlete_id,
      planId: plan.id,
    });

    const { error } = await supabase.from("plan_sessions").insert({
      plan_id: data.planId,
      athlete_id: plan.athlete_id,
      parent_id: parent.id,
      state_index: data.stateIndex,
      note: data.note,
      duration_seconds: data.durationSeconds,
    });
    if (error) {
      console.error("[submitPlanSession] insert failed", error);
      dbError(error);
    }
    console.info("[submitPlanSession] inserted ok", { planId: data.planId });
    return { ok: true as const };
  });
