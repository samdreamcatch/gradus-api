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
 * it. Edits after a bench move it, so only this athlete's sessions up to it
 * count, only moves that existed during the run get events, and the events
 * are dated at the run's last session. Idempotent per plan: a plan with a
 * bench answer or an earlier inference is never written again. Each plan is
 * handled on its own, so one failure never stops the run or its log.
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
export function inferLanding(
  sessions: { state_index: number; logged_at: string }[],
): number | null {
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
  /** Plans skipped because a read or write for them failed; the run goes on. */
  failedPlans: number;
  enabled: boolean;
}

/** Any of "false", "0", "off", "no" (any case) switches writing off. */
export function inferenceEnabled(value: string | undefined): boolean {
  return !/^(false|0|off|no)$/i.test((value ?? "").trim());
}

type CandidatePlan = {
  id: string;
  athlete_id: string;
  coach_id: string | null;
  updated_at: string;
};
type Session = { state_index: number; logged_at: string };

export async function runSkillInference(
  admin: SkillEventsDb,
  opts: { now?: Date; enabled?: boolean } = {},
): Promise<InferenceRunResult> {
  const now = opts.now ?? new Date();
  const enabled = opts.enabled ?? inferenceEnabled(process.env.SKILL_INFERENCE_ENABLED);
  const evaluateSince = new Date(now.getTime() - EVALUATE_LOOKBACK_DAYS * DAY).toISOString();
  const inferSince = now.getTime() - INFER_LOOKBACK_DAYS * DAY;

  const result: InferenceRunResult = {
    candidates: 0,
    labeled: 0,
    truePositive: 0,
    falsePositive: 0,
    falseNegative: 0,
    precision: null,
    writtenPlans: 0,
    writtenEvents: 0,
    failedPlans: 0,
    enabled,
  };

  try {
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
    const plans = (plansRes.data ?? []) as CandidatePlan[];
    result.candidates = plans.length;

    for (const plan of plans) {
      try {
        await considerPlan(admin, plan, { enabled, inferSince, result });
      } catch (e) {
        result.failedPlans += 1;
        console.warn("[skill-inference] plan skipped", plan.id, e);
      }
    }
  } catch (e) {
    console.error("[skill-inference] run failed", e);
  }

  const predicted = result.truePositive + result.falsePositive;
  result.precision = predicted ? Math.round((result.truePositive / predicted) * 1000) / 1000 : null;
  return logRun(admin, result, now);
}

async function considerPlan(
  admin: SkillEventsDb,
  plan: CandidatePlan,
  ctx: { enabled: boolean; inferSince: number; result: InferenceRunResult },
): Promise<void> {
  // Only a bench answer labels the whole plan (a removal answers for one
  // move); an earlier inference run means the plan is done.
  const evRes = await admin
    .from("athlete_skill_events")
    .select("origin, kind")
    .eq("plan_id", plan.id)
    .in("origin", ["bench", "inference"])
    .limit(200);
  if (evRes.error) dbError(evRes.error);
  const events = (evRes.data ?? []) as { origin: string; kind: string }[];
  const bench = events.filter((e) => e.origin === "bench");
  const labeled = bench.length > 0;
  const inferred = events.some((e) => e.origin === "inference");
  const inWindow = Date.parse(plan.updated_at) >= ctx.inferSince;
  if (!labeled && (inferred || !inWindow)) return;

  // This athlete's sessions on this plan up to the bench (a plan's athlete
  // can change while it is benched).
  const sRes = await admin
    .from("plan_sessions")
    .select("state_index, logged_at")
    .eq("plan_id", plan.id)
    .eq("athlete_id", plan.athlete_id)
    .lte("logged_at", plan.updated_at)
    .order("logged_at", { ascending: false })
    .limit(8);
  if (sRes.error) dbError(sRes.error);
  const sessions = (sRes.data ?? []) as Session[];
  const confidence = inferLanding(sessions);

  if (labeled) {
    ctx.result.labeled += 1;
    const landed = bench.some((e) => e.kind === "landed");
    if (confidence !== null && landed) ctx.result.truePositive += 1;
    else if (confidence !== null) ctx.result.falsePositive += 1;
    else if (landed) ctx.result.falseNegative += 1;
    return;
  }
  if (confidence === null || !ctx.enabled || !plan.coach_id) return;

  // The same rule as a coach's own answer (L1): nothing is written for an
  // athlete this coach no longer coaches.
  const link = await admin
    .from("coach_athletes")
    .select("athlete_id")
    .eq("coach_id", plan.coach_id)
    .eq("athlete_id", plan.athlete_id)
    .maybeSingle();
  if (link.error) dbError(link.error);
  if (!link.data) return;

  // Only moves that were in the plan during the run it is inferred from.
  const lastSession = sessions
    .map((x) => x.logged_at)
    .sort()
    .at(-1)!;
  const mRes = await admin
    .from("plan_moves")
    .select("id, move_id, name, created_at")
    .eq("plan_id", plan.id);
  if (mRes.error) dbError(mRes.error);
  const moves = (
    (mRes.data ?? []) as { id: string; move_id: string | null; name: string; created_at: string }[]
  )
    .filter((m) => !m.created_at || m.created_at <= lastSession)
    .map((m) => ({ planMoveId: m.id, moveId: m.move_id, name: m.name, startedAt: m.created_at }));
  if (!moves.length) return;

  ctx.result.writtenEvents += await recordInferredEvents(admin, {
    athleteId: plan.athlete_id,
    coachId: plan.coach_id,
    planId: plan.id,
    confidence,
    moves,
    // The run it rests on, not the bench-time stand-in (edits move updated_at).
    occurredAt: lastSession,
  });
  ctx.result.writtenPlans += 1;
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
      failed_plans: result.failedPlans,
      written_events: result.writtenEvents,
      enabled: result.enabled,
    });
    if (error) console.warn("[skill-inference] run log failed", error);
  } catch (e) {
    console.warn("[skill-inference] run log failed", e);
  }
  return result;
}
