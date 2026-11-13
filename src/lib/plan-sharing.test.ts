import { describe, expect, it } from "bun:test";
import {
  diffContent,
  matchMoves,
  moveChange,
  parseContent,
  planContent,
  sameContent,
  type PlanContent,
  type PlanContentMove,
} from "./plan-sharing";

const move = (name: string, over: Partial<PlanContentMove> = {}): PlanContentMove => ({
  moveId: null,
  name,
  description: "",
  cue: "",
  why: "",
  targetKind: "reps",
  targetValue: 10,
  ...over,
});

const content = (moves: PlanContentMove[], over: Partial<PlanContent> = {}): PlanContent => ({
  title: "Off-ice warm-up",
  notes: "",
  feedbackScope: "plan",
  moves,
  ...over,
});

describe("plan content", () => {
  it("reads stored rows into content, ignoring ids and positions", () => {
    const c = planContent({ title: "Warm-up", notes: null, feedback_scope: "moves" }, [
      {
        id: "pm-1",
        move_id: "lib-1",
        name: "Jump rope",
        description: null,
        cue: "Light feet",
        why: null,
        target_kind: "mins",
        target_value: "3",
      },
    ]);
    expect(c).toEqual({
      title: "Warm-up",
      notes: "",
      feedbackScope: "moves",
      moves: [
        {
          moveId: "lib-1",
          name: "Jump rope",
          description: "",
          cue: "Light feet",
          why: "",
          targetKind: "mins",
          targetValue: 3,
        },
      ],
    });
  });

  it("survives a round trip through stored JSON whatever the key order", () => {
    const c = content([move("Jump rope", { moveId: "lib-1", targetKind: "mins", targetValue: 3 })]);
    const stored = JSON.parse(
      JSON.stringify({ moves: c.moves, notes: c.notes, title: c.title, feedbackScope: "plan" }),
    );
    expect(sameContent(parseContent(stored), c)).toBe(true);
  });

  it("treats anything that is not a snapshot as nothing received", () => {
    expect(parseContent(null)).toBeNull();
    expect(parseContent("x")).toBeNull();
    expect(parseContent([])).toBeNull();
    expect(parseContent({ title: "A" })).toBeNull();
    expect(sameContent(null, content([]))).toBe(false);
  });

  it("matches only when title, notes, feedback, and every move in order are equal", () => {
    const a = content([move("A"), move("B")]);
    expect(sameContent(a, content([move("A"), move("B")]))).toBe(true);
    expect(sameContent(a, content([move("B"), move("A")]))).toBe(false);
    expect(sameContent(a, content([move("A"), move("B", { targetValue: 12 })]))).toBe(false);
    expect(sameContent(a, content([move("A"), move("B")], { notes: "Bring a mat" }))).toBe(false);
    expect(sameContent(a, content([move("A")]))).toBe(false);
  });
});

describe("matching moves", () => {
  it("pairs by library link first, so a renamed library move is the same move", () => {
    const m = matchMoves(
      [move("Jump rope", { moveId: "lib-1" })],
      [move("Skipping", { moveId: "lib-1" })],
    );
    expect(m).toEqual({ fromIndex: [0], removed: [] });
  });

  it("pairs unlinked moves by name, ignoring case and outer spaces", () => {
    expect(matchMoves([move("Arm circles")], [move("  arm Circles ")]).fromIndex).toEqual([0]);
  });

  it("pairs the same move twice in order, and reports what is left over", () => {
    const m = matchMoves([move("A"), move("A"), move("B")], [move("A"), move("C"), move("A")]);
    expect(m.fromIndex).toEqual([0, null, 1]);
    expect(m.removed).toEqual([2]);
  });
});

describe("what changed", () => {
  it("tags a target change by the unit the move now uses", () => {
    expect(moveChange(move("A"), move("A", { targetValue: 12 }))).toBe("reps");
    expect(moveChange(move("A"), move("A", { targetKind: "mins", targetValue: 3 }))).toBe(
      "minutes",
    );
  });

  it("tags a wording change, and prefers the target when both changed", () => {
    expect(moveChange(move("A"), move("A", { cue: "Tall" }))).toBe("changed");
    expect(moveChange(move("A"), move("A", { cue: "Tall", targetValue: 5 }))).toBe("reps");
    expect(moveChange(move("A"), move("A"))).toBeNull();
  });

  it("lists changed and new moves in plan order, then removed moves, then the plan's fields", () => {
    const before = content([move("A"), move("B"), move("C")]);
    const after = content(
      [move("A", { targetKind: "mins", targetValue: 5 }), move("C"), move("D")],
      { title: "Warm-up v2", notes: "Bring a mat" },
    );
    expect(diffContent(before, after)).toEqual([
      { index: 0, name: "A", change: "minutes" },
      { index: 2, name: "D", change: "new" },
      { index: null, name: "B", change: "removed" },
      { index: null, name: "", change: "title" },
      { index: null, name: "", change: "notes" },
    ]);
  });

  it("is empty when nothing differs, and one line for a pure reorder", () => {
    const a = content([move("A"), move("B")]);
    expect(diffContent(a, content([move("A"), move("B")]))).toEqual([]);
    expect(diffContent(a, content([move("B"), move("A")]))).toEqual([
      { index: null, name: "", change: "order" },
    ]);
  });

  it("notes a change of what the athlete rates", () => {
    const a = content([move("A")]);
    expect(diffContent(a, content([move("A")], { feedbackScope: "moves" }))).toEqual([
      { index: null, name: "", change: "feedback" },
    ]);
  });
});
