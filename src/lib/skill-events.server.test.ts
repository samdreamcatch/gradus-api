import { describe, expect, it } from "bun:test";
import {
  REASON_KIND,
  elementCategory,
  isCleanElement,
  normalizeElementCode,
  protocolEventRows,
  recordCoachReasonEvents,
  replaceProtocolEvents,
  skillReasonSchema,
} from "./skill-events.server";

/** Records every call; `lists[table]` answers awaited selects. */
function recordingAdmin(lists: Record<string, unknown[]> = {}) {
  const calls: { table: string; op: string; arg?: unknown; filters: [string, unknown][] }[] = [];
  const from = (table: string) => {
    const call = {
      table,
      op: "select",
      arg: undefined as unknown,
      filters: [] as [string, unknown][],
    };
    calls.push(call);
    const self: Record<string, unknown> = {};
    self.select = () => self;
    self.in = (col: string, v: unknown) => (call.filters.push([col, v]), self);
    self.eq = (col: string, v: unknown) => (call.filters.push([col, v]), self);
    self.insert = (rows: unknown) => ((call.op = "insert"), (call.arg = rows), self);
    self.delete = () => ((call.op = "delete"), self);
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: lists[table] ?? [], error: null });
    return self;
  };
  return { admin: { from }, calls };
}

describe("coach reasons", () => {
  it("map the three answers to landed, parked, and dropped", () => {
    expect(REASON_KIND).toEqual({
      landed_it: "landed",
      parking_it: "parked",
      changed_direction: "dropped",
    });
    expect(skillReasonSchema.safeParse("landed").success).toBe(false);
  });

  it("write one event per move, with the library move's sport and category", async () => {
    const { admin, calls } = recordingAdmin({
      moves: [{ id: "m1", sport: "tennis", category: "Serve" }],
      athlete_goals: [{ sport: "tennis" }],
    });
    const n = await recordCoachReasonEvents(admin, {
      athleteId: "a1",
      coachId: "c1",
      userId: "u1",
      planId: "p1",
      reason: "parking_it",
      moves: [
        { planMoveId: "pm1", moveId: "m1", name: "Kick serve" },
        { planMoveId: "pm2", moveId: null, name: "Footwork ladder" },
      ],
      now: new Date("2026-09-22T10:00:00Z"),
    });
    expect(n).toBe(2);
    const insert = calls.find((c) => c.op === "insert");
    expect(insert?.table).toBe("athlete_skill_events");
    const rows = insert?.arg as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      athlete_id: "a1",
      coach_id: "c1",
      kind: "parked",
      source: "coach",
      confidence: 1,
      sport: "tennis",
      move_id: "m1",
      plan_move_id: "pm1",
      plan_id: "p1",
      move_category: "Serve",
      occurred_at: "2026-09-22T10:00:00.000Z",
    });
    // No library link: the athlete's only sport, no category.
    expect(rows[1]).toMatchObject({
      move_id: null,
      sport: "tennis",
      move_name: "Footwork ladder",
      move_category: "",
    });
  });

  it("a benched plan with no moves still records one plan-level event", async () => {
    const { admin, calls } = recordingAdmin({
      athlete_goals: [{ sport: "golf" }, { sport: "tennis" }],
    });
    await recordCoachReasonEvents(admin, {
      athleteId: "a1",
      coachId: "c1",
      userId: "u1",
      planId: "p1",
      reason: "changed_direction",
      moves: [],
    });
    const rows = calls.find((c) => c.op === "insert")?.arg as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    // Two sports on file: unknown rather than a guess.
    expect(rows[0]).toMatchObject({
      kind: "dropped",
      move_id: null,
      plan_move_id: null,
      sport: "",
    });
  });
});

describe("protocol elements", () => {
  it("normalize the executed code without its judging marks", () => {
    expect(normalizeElementCode("3T<")).toBe("3T");
    expect(normalizeElementCode("3Lz<<")).toBe("3Lz");
    expect(normalizeElementCode("2A*")).toBe("2A");
    expect(normalizeElementCode("3Lze")).toBe("3Lz");
    expect(normalizeElementCode("3Fe+2T<")).toBe("3F+2T");
    expect(normalizeElementCode("3Sq")).toBe("3S");
    expect(normalizeElementCode("StSq2")).toBe("StSq2");
    expect(normalizeElementCode("CCoSp4")).toBe("CCoSp4");
  });

  it("group elements into families", () => {
    expect(elementCategory("2A")).toBe("jump");
    expect(elementCategory("2Lz+2Lo")).toBe("jump");
    expect(elementCategory("1Eu")).toBe("jump");
    expect(elementCategory("CCoSp3V")).toBe("spin");
    expect(elementCategory("FCSSp4")).toBe("spin");
    expect(elementCategory("StSq3")).toBe("step");
    expect(elementCategory("ChSq1")).toBe("choreo");
    expect(elementCategory("5TLi4")).toBe("other");
  });

  it("are clean only with non-negative GOE and no < or * mark", () => {
    expect(isCleanElement({ executed: "2A", goe: "0.33" })).toBe(true);
    expect(isCleanElement({ executed: "2A", goe: "0.00" })).toBe(true);
    expect(isCleanElement({ executed: "3T<", goe: "0.10" })).toBe(false);
    expect(isCleanElement({ executed: "2A*", goe: "0.00" })).toBe(false);
    expect(isCleanElement({ executed: "3S", goe: "-0.21" })).toBe(false);
    expect(isCleanElement({ executed: "3S", goe: "" })).toBe(false);
  });

  const results = [
    {
      eventName: "Juvenile Girls",
      segment: "Free Skate",
      protocol: {
        total: "",
        elementsScore: "",
        componentsScore: "",
        deductionsScore: "",
        elementsTotal: null,
        components: [],
        deductions: [],
        elements: [
          { planned: "2A", executed: "2A", baseValue: "3.30", goe: "0.33", score: "3.63" },
          { planned: "3T", executed: "3T<", baseValue: "3.36", goe: "-0.90", score: "2.46" },
        ],
      },
    },
    { eventName: "Juvenile Girls", segment: "Short", protocol: null },
  ];

  it("become attempted events, plus landed for each clean one", () => {
    const rows = protocolEventRows({
      athleteId: "a1",
      coachId: "c1",
      userId: "u1",
      competitionId: "comp1",
      occurredAt: "2026-09-20T12:00:00Z",
      results,
    });
    expect(rows.map((r) => [r.move_name, r.kind])).toEqual([
      ["2A", "attempted"],
      ["2A", "landed"],
      ["3T", "attempted"],
    ]);
    expect(rows[2]).toMatchObject({
      sport: "figure_skating",
      source: "protocol",
      element_code: "3T<",
      element_ref: "Juvenile Girls|Free Skate|1",
      move_category: "jump",
      competition_id: "comp1",
    });
  });

  it("replace the competition's earlier events instead of adding to them", async () => {
    const { admin, calls } = recordingAdmin();
    await replaceProtocolEvents(admin, {
      athleteId: "a1",
      coachId: "c1",
      userId: "u1",
      competitionId: "comp1",
      occurredAt: "2026-09-20T12:00:00Z",
      results,
    });
    expect(calls.map((c) => c.op)).toEqual(["delete", "insert"]);
    expect(calls[0].filters).toEqual([
      ["athlete_id", "a1"],
      ["competition_id", "comp1"],
      ["source", "protocol"],
    ]);
  });
});
