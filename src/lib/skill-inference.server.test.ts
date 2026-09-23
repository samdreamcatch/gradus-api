import { describe, expect, it } from "bun:test";
import { inferLanding, runSkillInference } from "./skill-inference.server";

const NOW = new Date("2026-09-22T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const sessions = (...states: number[]) =>
  // Newest first in the argument list.
  states.map((state_index, i) => ({ state_index, logged_at: daysAgo(i + 1) }));

describe("inferLanding", () => {
  it("needs three Locked in or Flowing sessions in a row, newest first", () => {
    expect(inferLanding(sessions(4, 3, 2, 4, 4))).toBeNull();
    expect(inferLanding(sessions(3, 4, 3, 1))).toBe(0.7);
    expect(inferLanding(sessions(4, 4, 3, 3))).toBe(0.8);
    expect(inferLanding(sessions(4, 4, 4, 4, 4, 4))).toBe(0.9);
    expect(inferLanding([])).toBeNull();
  });
});

/**
 * A fake admin that answers per table and, for plan-scoped reads, per plan
 * id (from the `eq("plan_id", …)` filter); records inserts.
 */
function fakeAdmin(data: {
  plans: unknown[];
  events: unknown[];
  sessionsByPlan: Record<string, unknown[]>;
  movesByPlan: Record<string, unknown[]>;
}) {
  const inserts: { table: string; rows: unknown }[] = [];
  const from = (table: string) => {
    let planId: string | undefined;
    const self: Record<string, unknown> = {};
    for (const m of ["select", "in", "not", "gte", "lte", "order", "limit"]) self[m] = () => self;
    self.eq = (col: string, v: unknown) => {
      if (col === "plan_id") planId = v as string;
      return self;
    };
    self.insert = (rows: unknown) => {
      inserts.push({ table, rows });
      return self;
    };
    self.then = (resolve: (v: unknown) => void) => {
      const rows =
        table === "plans"
          ? data.plans
          : table === "athlete_skill_events"
            ? data.events
            : table === "plan_sessions"
              ? (data.sessionsByPlan[planId ?? ""] ?? [])
              : table === "plan_moves"
                ? (data.movesByPlan[planId ?? ""] ?? [])
                : [];
      resolve({ data: rows, error: null });
    };
    return self;
  };
  return { admin: { from }, inserts };
}

const plan = (id: string, updatedDaysAgo: number) => ({
  id,
  athlete_id: `athlete-${id}`,
  coach_id: "c1",
  updated_at: daysAgo(updatedDaysAgo),
});

describe("runSkillInference", () => {
  const base = {
    plans: [
      plan("labeled-landed", 5), // coach said landed; rule agrees → true positive
      plan("labeled-parked", 5), // coach said parking; rule says landed → false positive
      plan("unlabeled", 3), // no answer, sustained run → inferred events
      plan("already", 3), // already inferred → skipped
      plan("old", 90), // outside the inference window, unlabeled → skipped
    ],
    events: [
      { plan_id: "labeled-landed", source: "coach", kind: "landed" },
      { plan_id: "labeled-parked", source: "coach", kind: "parked" },
      { plan_id: "already", source: "inferred", kind: "landed" },
    ],
    sessionsByPlan: {
      "labeled-landed": sessions(4, 4, 3),
      "labeled-parked": sessions(3, 3, 3),
      unlabeled: sessions(4, 3, 3, 3),
      already: sessions(4, 4, 4),
      old: sessions(4, 4, 4),
    },
    movesByPlan: {
      unlabeled: [
        { id: "pm1", move_id: null, name: "Axel" },
        { id: "pm2", move_id: null, name: "Loop" },
      ],
      already: [{ id: "pm3", move_id: null, name: "Flip" }],
      old: [{ id: "pm4", move_id: null, name: "Lutz" }],
    },
  };

  it("writes likely-landed events for unanswered plans and scores itself on the answered ones", async () => {
    const { admin, inserts } = fakeAdmin(base);
    const result = await runSkillInference(admin, { now: NOW, enabled: true });
    expect(result).toMatchObject({
      candidates: 5,
      labeled: 2,
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 0,
      precision: 0.5,
      writtenPlans: 1,
      writtenEvents: 2,
    });
    const events = inserts.find((i) => i.table === "athlete_skill_events")?.rows as Record<
      string,
      unknown
    >[];
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      athlete_id: "athlete-unlabeled",
      plan_id: "unlabeled",
      kind: "landed",
      source: "inferred",
      confidence: 0.8,
      created_by_user_id: null,
    });
    const log = inserts.find((i) => i.table === "skill_inference_runs")?.rows;
    expect(log).toMatchObject({ precision: 0.5, written_events: 2, enabled: true });
  });

  it("switched off, it still measures but writes nothing", async () => {
    const { admin, inserts } = fakeAdmin(base);
    const result = await runSkillInference(admin, { now: NOW, enabled: false });
    expect(result.writtenEvents).toBe(0);
    expect(result.precision).toBe(0.5);
    expect(inserts.some((i) => i.table === "athlete_skill_events")).toBe(false);
  });
});
