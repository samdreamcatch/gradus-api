import { describe, expect, it } from "bun:test";
import { weekStart, targetPercent, sumCoachWeeks } from "./club-coach-metrics";

describe("Club weekly aggregates", () => {
  it("weeks begin on Monday in UTC including Sunday", () => {
    expect(weekStart(new Date("2026-11-01T03:18:00Z"))).toBe("2026-10-26");
    expect(weekStart(new Date("2026-11-02T00:00:00Z"))).toBe("2026-11-02");
  });
  it("missing or zero targets never become a fabricated percentage", () => {
    expect(targetPercent(120, null)).toBeNull();
    expect(targetPercent(120, 0)).toBeNull();
    expect(targetPercent(120, 240)).toBe(50);
  });
  it("unknown historical counts and targets remain unknown in club totals", () => {
    const total = sumCoachWeeks([{ coach_id: "coach", week_start: "2026-10-26", students: null, minors: null, practice_min: 60, target_min: null, sessions: 2, computed_at: "2026-11-01" }]);
    expect(total).toEqual({ students: null, practice: 60, target: null, sessions: 2 });
  });
});