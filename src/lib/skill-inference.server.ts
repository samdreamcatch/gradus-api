/**
 * The nightly skill-inference job (PRD §6.7 item 5, milestone L3).
 *
 * When a coach benches an athlete's plan without answering the "why?" prompt
 * (decision #17 makes it skippable), nothing says whether the moves were
 * landed. This job looks at the practice sessions logged against that plan
 * just before it was benched: a sustained run of Locked in / Flowing sessions
 * (state_index >= 3, the canonical scale in `session-states.ts`) is read as
 * "likely landed", and each of the plan's moves gets a `landed` event with
 * `source = inferred` and a confidence below 1. The profile shows those
 * separately as "likely"; they are never promoted to certain.
 *
 * The coach-answered plans are the check on the rule: every run replays it
 * against them and records precision (of the plans the rule would call
 * landed, how many the coach said "landed it") in `skill_inference_runs`, so
 * the rule can be tuned — or switched off with `SKILL_INFERENCE_ENABLED=false`,
 * which keeps measuring but stops writing.
 *
 * Bench time: `plans` has no status timestamp, so `updated_at` stands in for
 * it (a benched plan is rarely edited afterwards). Idempotent: a plan that
 * already has inferred or coach events is never written again.
 */
import { dbError } from "./db-error";
import { recordInferredEvents, type SkillEventsDb } from "./skill-events.server";

/** Plans benched this recently get inferred events; older ones only count toward precision. */
export const INFER_LOOKBACK_DAYS = 30;
/** How far back coach-answered plans are replayed for the precision check. */
export const EVALUATE_LOOKBACK_DAYS = 365;
/** Consecutive Locked in / Flowing sessions, newest first, that count as a sustained run. */
export const MIN_RUN = 3;
const HIGH_FLOW = 3;
const MAX_PLANS = 500;

const DAY = 86_400_000;

/**
 * Confidence that a plan's moves were landed, from its sessions before the
 * bench (any order), or null when there is no sustained run: 3 in a row →
 * 0.7, 4 → 0.8, 5 or more → 0.9.
 */
export function inferLanding(sessions: { state_index: number; logged_at: string }[]): number | null {
  const newestFirst = [...sessions].sort((a, b) => b.logged_at.localeCompare(a.logged_at));
  let run = 0;
  for (const s of newestFirst) {
    if (s.state_index >= HIGH_FLOW) run += 1;
    else break;
  }
  if (run < MIN_RUN) return null;
  return Math.min(0.9, Math.round((0.4 + 0.1 * run) * 100) / 100);
}

export interface InferenceRunResult {
  candidates: number;
  labeled: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number | null;
  writtenPlans: number;
  writtenEvents: number;
  enabled: boolean;
}

export async function runSkillInference(
  admin: SkillEventsDb,
  opts: { now?: Date; enabled?: boolean } = {},
): Promise<InferenceRunResult> {
  const now = opts.now ?? new Date();
  const enabled = opts.enabled ?? process.env.SKILL_INFERENCE_ENABLED !== "false";
  const evaluateSince = new Date(now.getTime() - EVALUATE_LOOKBACK_DAYS * DAY).toISOString();
  const inferSince = now.getTime() - INFER_LOOKBACK_DAYS * DAY;

  const plansRes = await admin
    .from("plans")
    .select("id, athlete_id, coach_id, updated_at")
    .eq("kind", "plan")
    .eq("status", "benched")
    .not("athlete_id", "is", null)
    .gte("updated_at", evaluateSince)
    .order("updated_at", { ascending: false })
    .limit(MAX_PLANS);
  if (plansRes.error) dbError(plansRes.error);
  const plans = (plansRes.data ?? []) as {
    id: string;
    athlete_id: string;
    coach_id: string | null;
    updated_at: string;
  }[];

  const result: InferenceRunResult = {
    candidates: plans.length,
    labeled: 0,
    truePositive: 0,
    falsePositive: 0,
    falseNegative: 0,
    precision: null,
    writtenPlans: 0,
    writtenEvents: 0,
    enabled,
  };
  if (!plans.length) return logRun(admin, result, now);

  const evRes = await admin
    .from("athlete_skill_events")
    .select("plan_id, source, kind")
    .in(
      "plan_id",
      plans.map((p) => p.id),
    )
    .in("source", ["coach", "inferred"]);
  if (evRes.error) dbError(evRes.error);
  const byPlan = new Map<string, { coach: Set<string>; inferred: boolean }>();
  for (const e of (evRes.data ?? []) as { plan_id: string; source: string; kind: string }[]) {
    const entry = byPlan.get(e.plan_id) ?? { coach: new Set<string>(), inferred: false };
    if (e.source === "coach") entry.coach.add(e.kind);
    else entry.inferred = true;
    byPlan.set(e.plan_id, entry);
  }

  for (const plan of plans) {
    const known = byPlan.get(plan.id);
    const labeled = !!known?.coach.size;
    const inWindow = Date.parse(plan.updated_at) >= inferSince;
    if (!labeled && (known?.inferred || !inWindow)) continue;

    const sRes = await admin
      .from("plan_sessions")
      .select("state_index, logged_at")
      .eq("plan_id", plan.id)
      .lte("logged_at", plan.updated_at)
      .order("logged_at", { ascending: false })
      .limit(8);
    if (sRes.error) dbError(sRes.error);
    const confidence = inferLanding((sRes.data ?? []) as { state_index: number; logged_at: string }[]);

    if (labeled) {
      result.labeled += 1;
      const landed = known!.coach.has("landed");
      if (confidence !== null && landed) result.truePositive += 1;
      else if (confidence !== null) result.falsePositive += 1;
      else if (landed) result.falseNegative += 1;
      continue;
    }
    if (confidence === null || !enabled) continue;

    const mRes = await admin.from("plan_moves").select("id, move_id, name").eq("plan_id", plan.id);
    if (mRes.error) dbError(mRes.error);
    const moves = ((mRes.data ?? []) as { id: string; move_id: string | null; name: string }[]).map(
      (m) => ({ planMoveId: m.id, moveId: m.move_id, name: m.name }),
    );
    if (!moves.length) continue;
    result.writtenEvents += await recordInferredEvents(admin, {
      athleteId: plan.athlete_id,
      coachId: plan.coach_id,
      planId: plan.id,
      confidence,
      moves,
      occurredAt: plan.updated_at,
    });
    result.writtenPlans += 1;
  }

  const predicted = result.truePositive + result.falsePositive;
  result.precision = predicted ? Math.round((result.truePositive / predicted) * 1000) / 1000 : null;
  return logRun(admin, result, now);
}

/** The precision log (best effort: a failed log never fails the run). */
async function logRun(
  admin: SkillEventsDb,
  result: InferenceRunResult,
  now: Date,
): Promise<InferenceRunResult> {
  try {
    const { error } = await admin.from("skill_inference_runs").insert({
      ran_at: now.toISOString(),
      candidates: result.candidates,
      labeled: result.labeled,
      true_positive: result.truePositive,
      false_positive: result.falsePositive,
      false_negative: result.falseNegative,
      precision: result.precision,
      written_plans: result.writtenPlans,
      written_events: result.writtenEvents,
      enabled: result.enabled,
    });
    if (error) console.warn("[skill-inference] run log failed", error);
  } catch (e) {
    console.warn("[skill-inference] run log failed", e);
  }
  return result;
}
