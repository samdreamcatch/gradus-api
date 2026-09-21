import { describe, expect, it } from "bun:test";
import { summarySessionLine } from "./coach-athlete-detail.server";
import { STATE_LABELS } from "./session-states";

/**
 * The coach's AI summary must describe a session with the same flow-state
 * words the athlete or parent chose. Until 2026-09-20 this module carried a
 * second, mastery-flavored scale for the same `state_index`, so "Steady"
 * reached the coach as "Comfortable" and "Locked in" as "Flowing".
 */
describe("summarySessionLine", () => {
  const base = {
    logged_at: "2026-09-18T15:00:00.000Z",
    duration_seconds: 1500,
    parent_id: null,
    note: "",
    plan_id: null,
  };

  it("uses the canonical flow-state labels for every index", () => {
    const expected = ["Frustrated", "Pushing", "Steady", "Locked in", "Flowing"];
    expect([...STATE_LABELS]).toEqual(expected);
    for (let i = 0; i < 5; i++) {
      const line = summarySessionLine({ ...base, state_index: i }, new Map());
      expect(line).toContain(`"${expected[i]}"`);
      expect(line).not.toMatch(/Just learning|Getting it|Comfortable|Mastered/);
    }
  });

  it("clamps out-of-range and missing indexes instead of throwing", () => {
    expect(summarySessionLine({ ...base, state_index: null }, new Map())).toContain('"Frustrated"');
    expect(summarySessionLine({ ...base, state_index: 9 }, new Map())).toContain('"Flowing"');
  });

  it("keeps the rest of the line: date, attribution, minutes, plan tag, wrapped note", () => {
    const planById = new Map([["p1", { title: "Axel prep", status: "active" }]]);
    const line = summarySessionLine(
      { ...base, state_index: 2, parent_id: "parent", plan_id: "p1", note: "felt good" },
      planById,
    );
    expect(line).toContain('2026-09-18 (parent-logged, 25m, "Steady" plan="Axel prep" (active))');
    expect(line).toContain("felt good");
  });
});
