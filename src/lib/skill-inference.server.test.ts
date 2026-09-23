import { describe, expect, it } from "bun:test";
import { inferLanding, inferenceEnabled, runSkillInference } from "./skill-inference.server";

const NOW = new Date("2026-09-22T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
/** Sessions, newest first in the argument list, `start` days before now. */
const sessions = (start: number, ...states: number[]) =>
  states.map((state_index, i) => ({ state_index, logged_at: daysAgo(start + i) }));

describe("inferLanding", () => {
  it("needs three Locked in or Flowing sessions in a row, newest first", () => {
    expect(inferLanding(sessions(1, 4, 3, 2, 4, 4))).toBeNull();
    expect(inferLanding(sessions(1, 3, 4, 3, 1))).toBe(0.7);
    expect(inferLanding(sessions(1, 4, 4, 3, 3))).toBe(0.8);
    expect(inferLanding(sessions(1, 4, 4, 4, 4, 4, 4))).toBe(0.9);
    expect(inferLanding([])).toBeNull();
  });
});

describe("inferenceEnabled", () => {
  it("reads the usual ways of saying off", () => {
    for (const v of ["false", "FALSE", "0", "off", "No", " false "]) {
      expect(inferenceEnabled(v)).toBe(false);
    }
    for (const v of [undefined, "", "true", "1", "on"]) expect(inferenceEnabled(v)).toBe(true);
  });
});

type Plan = { id: string; athlete_id: string; coach_id: string | null; updated_at: string };

/**
 * Answers per table and, for plan-scoped reads, per plan id (the
 * `eq("plan_id", …)` filter); `lte("logged_at", …)` and the athlete filter
 * are applied to sessions so the "before the bench" rule is really tested.
 */
function fakeAdmin(data: {
  plans: Plan[];
  eventsByPlan: Record<string, { origin: string; kind: string }[]>;
  sessionsByPlan: Record<string, { state_index: number; logged_at: string; athlete_id: string }[]>;
  movesByPlan: Record<
    string,
    { id: string; move_id: string | null; name: string; created_at: string }[]
  >;
  rostered: Set<string>;
}) {
  const inserts: { table: string; rows: unknown }[] = [];
  const from = (table: string) => {
    const f: Record<string, unknown> = {};
    let lte: string | undefined;
    const self: Record<string, unknown> = {};
    for (const m of ["select", "in", "not", "gte", "order", "limit"]) self[m] = () => self;
    self.eq = (col: string, v: unknown) => ((f[col] = v), self);
    self.lte = (_col: string, v: string) => ((lte = v), self);
    self.insert = (rows: unknown) => (inserts.push({ table, rows }), self);
    self.maybeSingle = async () => ({
      data:
        table === "coach_athletes" && data.rostered.has(`${f.coach_id}:${f.athlete_id}`)
          ? { athlete_id: f.athlete_id }
          : null,
      error: null,
    });
    self.then = (resolve: (v: unknown) => void) => {
      const plan = f.plan_id as string;
      const rows =
        table === "plans"
          ? data.plans
          : table === "athlete_skill_events"
            ? (data.eventsByPlan[plan] ?? [])
            : table === "plan_sessions"
              ? (data.sessionsByPlan[plan] ?? [])
                  .filter((s) => s.athlete_id === f.athlete_id && (!lte || s.logged_at <= lte))
                  .sort((a, b) => b.logged_at.localeCompare(a.logged_at))
              : table === "plan_moves"
                ? (data.movesByPlan[plan] ?? [])
                : [];
      resolve({ data: rows, error: null });
    };
    return self;
  };
  return { admin: { from }, inserts };
}

const plan = (id: string, updatedDaysAgo: number, athlete = `athlete-${id}`): Plan => ({
  id,
  athlete_id: athlete,
  coach_id: "c1",
  updated_at: daysAgo(updatedDaysAgo),
});
const run = (id: string, start: number, ...states: number[]) =>
  sessions(start, ...states).map((s) => ({ ...s, athlete_id: `athlete-${id}` }));

const base = () => ({
  plans: [
    plan("labeled-landed", 5), // bench answer: landed; rule agrees → true positive
    plan("labeled-parked", 5), // bench answer: parking; rule says landed → false positive
    plan("removal-only", 3), // only a removal answer: not a label → inferred like any other
    plan("unlabeled", 3), // no answer, sustained run → inferred events
    plan("already", 3), // already inferred → skipped
    plan("old", 90), // outside the inference window, unlabeled → skipped
    plan("former", 3), // the athlete left this coach's roster → skipped
  ],
  eventsByPlan: {
    "labeled-landed": [{ origin: "bench", kind: "landed" }],
    "labeled-parked": [{ origin: "bench", kind: "parked" }],
    already: [{ origin: "inference", kind: "landed" }],
  } as Record<string, { origin: string; kind: string }[]>,
  sessionsByPlan: {
    "labeled-landed": run("labeled-landed", 6, 4, 4, 3),
    "labeled-parked": run("labeled-parked", 6, 3, 3, 3),
    "removal-only": run("removal-only", 4, 4, 4, 4),
    // Two Flowing sessions logged after the bench don't count; before it: 4, 3, 3, 3.
    unlabeled: [...run("unlabeled", 1, 4, 4), ...run("unlabeled", 4, 4, 3, 3, 3)],
    already: run("already", 4, 4, 4, 4),
    old: run("old", 91, 4, 4, 4),
    former: run("former", 4, 4, 4, 4),
  },
  movesByPlan: {
    "removal-only": [{ id: "pm0", move_id: null, name: "Spin", created_at: daysAgo(30) }],
    unlabeled: [
      { id: "pm1", move_id: null, name: "Axel", created_at: daysAgo(30) },
      { id: "pm2", move_id: null, name: "Loop", created_at: daysAgo(30) },
      // Added after the run it would be inferred from: never "likely landed".
      { id: "pm9", move_id: null, name: "Lutz", created_at: daysAgo(2) },
    ],
    former: [{ id: "pm8", move_id: null, name: "Flip", created_at: daysAgo(30) }],
  },
  rostered: new Set(["c1:athlete-unlabeled", "c1:athlete-removal-only"]),
});

describe("runSkillInference", () => {
  it("writes likely-landed events for unanswered plans and scores itself on bench answers", async () => {
    const { admin, inserts } = fakeAdmin(base());
    const result = await runSkillInference(admin, { now: NOW, enabled: true });
    expect(result).toMatchObject({
      candidates: 7,
      labeled: 2,
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 0,
      precision: 0.5,
      writtenPlans: 2,
      writtenEvents: 3,
      failedPlans: 0,
    });
    const events = inserts
      .filter((i) => i.table === "athlete_skill_events")
      .flatMap((i) => i.rows as Record<string, unknown>[]);
    const unlabeled = events.filter((e) => e.plan_id === "unlabeled");
    expect(unlabeled.map((e) => e.plan_move_id)).toEqual(["pm1", "pm2"]);
    expect(unlabeled[0]).toMatchObject({
      athlete_id: "athlete-unlabeled",
      kind: "landed",
      source: "inferred",
      origin: "inference",
      confidence: 0.8,
      created_by_user_id: null,
      occurred_at: daysAgo(4),
    });
    expect(events.some((e) => e.plan_id === "former")).toBe(false);
    const log = inserts.find((i) => i.table === "skill_inference_runs")?.rows;
    expect(log).toMatchObject({
      precision: 0.5,
      written_events: 3,
      failed_plans: 0,
      enabled: true,
    });
  });

  it("switched off, it still measures but writes nothing", async () => {
    const { admin, inserts } = fakeAdmin(base());
    const result = await runSkillInference(admin, { now: NOW, enabled: false });
    expect(result.writtenEvents).toBe(0);
    expect(result.precision).toBe(0.5);
    expect(inserts.some((i) => i.table === "athlete_skill_events")).toBe(false);
  });

  it("keeps going, and still logs, when one plan's reads fail", async () => {
    const data = base();
    const { admin, inserts } = fakeAdmin(data);
    const failing = {
      from: (table: string) => {
        const chain = admin.from(table) as Record<string, unknown>;
        if (table !== "plan_moves") return chain;
        return {
          ...chain,
          select: () => ({
            eq: (_c: string, id: string) =>
              id === "unlabeled"
                ? {
                    then: (r: (v: unknown) => void) =>
                      r({ data: null, error: { message: "boom" } }),
                  }
                : (chain.eq as (c: string, v: string) => unknown)("plan_id", id),
          }),
        };
      },
    };
    const result = await runSkillInference(failing, { now: NOW, enabled: true });
    expect(result.failedPlans).toBe(1);
    expect(result.writtenPlans).toBe(1);
    expect(inserts.some((i) => i.table === "skill_inference_runs")).toBe(true);
  });
});
