import { describe, expect, it } from "bun:test";
import { planDraftPrompt, planImprovePrompt } from "./plan-draft-prompt";
import { PLAN_BANNED_WORDS, PLAN_WORD_LIMITS } from "./plan-writing-style";

const NOTES = "Bump & run. Narrow stance, hands ahead. 4 balls, keep it under the Gobbler handle.";

describe("planDraftPrompt", () => {
  const notes = planDraftPrompt({
    sport: "golf",
    source: { kind: "source", pastedText: NOTES, maxMoves: 5 },
  });
  const brief = planDraftPrompt({
    sport: "figure skating",
    source: { kind: "brief", level: "juvenile", focus: "edges", moveCount: 4 },
  });

  it("states every word limit as a number the checker shares", () => {
    for (const limit of Object.values(PLAN_WORD_LIMITS)) {
      expect(notes).toContain(`under ${limit} words`);
    }
  });

  it("is written for a public reader of the given sport, not an athlete", () => {
    expect(notes).toContain("for golf");
    expect(brief).toContain("for figure skating");
    for (const p of [notes, brief]) {
      expect(p).toContain('speak to the reader as "you"');
      expect(p).toContain("describe no particular athlete");
    }
  });

  it("is sport-agnostic: its illustrations span sports and none is the handoff's golf lesson", () => {
    const skating = planDraftPrompt({
      sport: "figure skating",
      source: { kind: "source", pastedText: "", maxMoves: 4 },
    });
    expect(skating).not.toMatch(/Gobbler|on the range|bump & run|no click/i);
    expect(skating).toContain("3 laps on each foot");
    expect(skating).toContain("3 shots with each of 3 clubs");
  });

  it("derives reps from a drill's structure and infers a why when the coach gave none", () => {
    expect(notes).toContain("3 shots with each of 3 clubs is 9 reps");
    expect(notes).toContain("Never a round number from nowhere");
    expect(notes).toContain("otherwise the usual reason a coach assigns this move");
  });

  it("names the jargon the checker bans", () => {
    for (const w of ["trajectory", "mechanics", "calibration"]) expect(notes).toContain(w);
    expect(PLAN_BANNED_WORDS).toContain("trajectory");
  });

  it("wraps pasted notes as untrusted data behind the guard, after the rules", () => {
    expect(notes.startsWith("SECURITY:")).toBe(true);
    expect(notes).toContain('<untrusted_user_content> label="source"');
    expect(notes.indexOf("Gobbler handle")).toBeGreaterThan(
      notes.indexOf("HOW A NOTE BECOMES A MOVE"),
    );
    expect(notes).toContain("up to 5");
    expect(notes).toContain("A checklist (set-up, positions, form points) is its own move");
  });

  it("a brief has no source, no guard, and exactly N moves", () => {
    expect(brief.startsWith("You write Gradus practice plans")).toBe(true);
    expect(brief).not.toContain("untrusted_user_content");
    expect(brief).toContain("Write exactly 4 moves");
    expect(brief).toContain("Level: juvenile");
    expect(brief).toContain("Focus: edges");
  });

  it("the worked example says not to reuse it", () => {
    expect(notes).toContain("not reused for a different note");
  });
});

describe("planImprovePrompt", () => {
  it("carries the same plan rules, the editor's instruction, and the current moves", () => {
    const p = planImprovePrompt({
      sport: "tennis",
      level: "",
      title: "Serve Rhythm",
      notes: "",
      instruction: "make the cues shorter",
      moves: [
        {
          name: "Toss and catch",
          description: "",
          cue: "",
          why: "",
          targetKind: "reps",
          targetValue: 10,
        },
      ],
    });
    expect(p).toContain("You write Gradus practice plans for tennis");
    expect(p).toContain("Instruction: make the cues shorter");
    expect(p).toContain('"Toss and catch"');
    expect(p).toContain("the instruction wins");
    expect(p).toContain('JSON only: {"moves"');
  });
});
