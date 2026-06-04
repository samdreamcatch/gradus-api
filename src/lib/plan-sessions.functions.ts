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

  // Fetch each plan's current athlete_id so we can exclude sessions left over
  // from a previous athlete after the plan was reassigned.
  const { data: plans, error: pErr } = await supabase
    .from("plans")
    .select("id, athlete_id")
    .in("id", planIds);
  if (pErr) dbError(pErr);
  const planAthlete = new Map<string, string | null>(
    (plans ?? []).map((p) => [p.id, p.athlete_id]),
  );

  const { data, error } = await supabase
    .from("plan_sessions")
    .select("plan_id, athlete_id, state_index")
    .in("plan_id", planIds);
  if (error) dbError(error);

  for (const row of data ?? []) {
    if (planAthlete.get(row.plan_id) !== row.athlete_id) continue;
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
    if (pErr) dbError(pErr);
    if (ppErr) dbError(ppErr);
    if (!plan?.athlete_id) throw new Error("Plan not found");
    if (!parent) throw new Error("Parent profile not found");

    const { error } = await supabase.from("plan_sessions").insert({
      plan_id: data.planId,
      athlete_id: plan.athlete_id,
      parent_id: parent.id,
      state_index: data.stateIndex,
      note: data.note,
      duration_seconds: data.durationSeconds,
    });
    if (error) dbError(error);
    return { ok: true as const };
  });

/** Athlete-only: submit a session for one of the signed-in athlete's plans. */
export const submitAthletePlanSession = createServerFn({ method: "POST" })
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

    const [{ data: athlete, error: aErr }, { data: plan, error: pErr }] = await Promise.all([
      supabase
        .from("athletes")
        .select("id")
        .eq("user_id", context.userId)
        .maybeSingle(),
      supabase
        .from("plans")
        .select("id, athlete_id")
        .eq("id", data.planId)
        .maybeSingle(),
    ]);
    if (aErr) dbError(aErr);
    if (pErr) dbError(pErr);
    if (!athlete) throw new Error("Athlete profile not found");
    if (!plan || plan.athlete_id !== athlete.id) throw new Error("Plan not found");

    const { error } = await supabase.from("plan_sessions").insert({
      plan_id: data.planId,
      athlete_id: athlete.id,
      parent_id: null,
      state_index: data.stateIndex,
      note: data.note,
      duration_seconds: data.durationSeconds,
    });
    if (error) dbError(error);
    return { ok: true as const };
  });
