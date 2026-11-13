import { describe, expect, it } from "bun:test";
import { coachComparison, sessionFeel, stuckStudents, type InsightInput } from "./club-insights";

const base: InsightInput = {
  coaches: [{ id: "c1", name: "Tami" }, { id: "c2", name: "Eric" }],
  weeks: [],
  links: [{ coach_id: "c1", athlete_id: "a1" }, { coach_id: "c1", athlete_id: "a2" }, { coach_id: "c2", athlete_id: "a3" }],
  students: [{ id: "a1", name: "Ann" }, { id: "a2", name: "Ben" }, { id: "a3", name: "Cal" }],
  plans: [{ id: "p1", coach_id: "c1", athlete_id: "a1", status: "active" }, { id: "p2", coach_id: "c1", athlete_id: "a2", status: "active" }, { id: "p3", coach_id: "c2", athlete_id: "a3", status: "archived" }],
  sessions: [
    { plan_id: "p1", athlete_id: "a1", duration_seconds: 7200, state_index: 4, logged_at: "2026-11-02T10:00:00Z" },
    { plan_id: "p2", athlete_id: "a2", duration_seconds: 7200, state_index: 0, logged_at: "2026-11-03T10:00:00Z" },
    { plan_id: "p3", athlete_id: "a3", duration_seconds: 600, state_index: 2, logged_at: "2026-11-03T10:00:00Z" },
  ],
  skills: [{ athlete_id: "a1", coach_id: "c1", kind: "landed", occurred_at: "2026-10-30T00:00:00Z" }],
};

describe("club insights", () => {
  it("flags students with 120+ practice minutes and no landed/consistent move as stuck", () => {
    const r = stuckStudents(base, "2026-09-14");
    expect(r.rows.map((x) => x.student)).toEqual(["Ben"]);
  });
  it("splits a coach's sessions into difficulty shares", () => {
    const r = sessionFeel(base, "2026-10-01T00:00:00Z");
    const tami = r.rows.find((x) => x.coach === "Tami");
    expect([tami?.s0, tami?.s4, tami?.sessions]).toEqual([50, 50, 2]);
  });
  for (const [index, rating] of ["Easy", "A bit easy", "Just right", "A bit hard", "Hard"].entries()) {
    it(`counts stored rating ${index} as ${rating} for the assigned coach`, () => {
      const sessions = Array.from({ length: 5 }, (_, state_index) => ({
        plan_id: "p1", athlete_id: "a1", duration_seconds: 600,
        state_index, logged_at: "2026-11-02T10:00:00Z",
      }));
      sessions.push({ ...sessions[index], plan_id: "p1", athlete_id: "a1", duration_seconds: 600, state_index: index, logged_at: "2026-11-02T10:00:00Z" });
      const result = sessionFeel({ ...base, sessions }, "2026-10-01T00:00:00Z");
      const coach = result.rows.find((r) => r.coach === "Tami");
      expect(coach?.[`s${index}`]).toBe(33);
      expect(coach?.sessions).toBe(6);
      expect(result.rows.find((r) => r.coach === "Eric")?.[`s${index}`]).toBeNull();
    });
  }
  it("counts only active plans and progress events per coach", () => {
    const r = coachComparison(base, [], "2026-10-01");
    expect(r.rows.map((x) => [x.coach, x.plans, x.progressed])).toEqual([["Tami", 2, 1], ["Eric", 0, 0]]);
  });
});
