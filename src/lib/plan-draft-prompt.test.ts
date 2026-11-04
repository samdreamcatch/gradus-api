import { describe, expect, it } from "bun:test";
import { planDraftPrompt, planImprovePrompt } from "./plan-draft-prompt";
import type { LibraryMove } from "./plan-draft-library";

const LIB: LibraryMove[] = [
  {
    name: "Bump and Run",
    category: "Short game",
    description: "A low chip that lands short and rolls.",
    cue: "Hands ahead.",
    why: "Safe.",
    defaultTargetKind: "reps",
    defaultTargetValue: 12,
  },
];
const NOTES = "Bump & run. Narrow stance, hands ahead. 4 balls, keep it under the Gobbler handle.";

describe("planDraftPrompt", () => {
  const notes = planDraftPrompt({
    sportLabel: "Golf",
    library: LIB,
    source: { kind: "source", pastedText: NOTES, maxMoves: 5 },
  });
  const brief = planDraftPrompt({
    sportLabel: "Figure Skating",
    library: [],
    source: { kind: "brief", level: "Juvenile", focus: "edges", moveCount: 4 },
  });

  it("frames the job as converting a workout into a public Gradus plan for the sport", () => {
    expect(notes).toContain("convert an existing workout into a Gradus practice plan for Golf");
    expect(notes).toContain('speaks to the reader as "you"');
    expect(notes).toContain("describes no particular athlete");
    expect(notes).toContain("Clarity first");
    expect(notes).not.toMatch(/\d+ words max|under \d+ words/);
  });

  it("defines the fields as Mariah did: description is what the move is, cue is the parent's words, why is why it is assigned", () => {
    expect(notes).toContain("description: what the move is and how it is done");
    expect(notes).toContain("cue: the few words a parent says in the moment");
    expect(notes).toContain("why: why this move matters or gets assigned");
    expect(notes).toContain("A set-up checklist is never a move of its own");
    expect(notes).toContain("A game in the source is split into the moves it exercises");
  });

  it("lists the sport's library and asks for the match by exact name", () => {
    expect(notes).toContain("GRADUS LIBRARY for Golf");
    expect(notes).toContain("- Bump and Run | Short game | A low chip that lands short and rolls.");
    expect(notes).toContain("libraryName: the exact name from the GRADUS LIBRARY");
    expect(brief).toContain("The library has no moves for this sport");
  });

  it("derives reps from structure and otherwise leaves the target null", () => {
    expect(notes).toContain("3 shots with each of 3 clubs is 9 reps");
    expect(notes).toContain("Otherwise null. Never a number from nowhere");
  });

  it("wraps pasted text as untrusted data behind the guard, after the rules, and keeps the result branch", () => {
    expect(notes.startsWith("SECURITY:")).toBe(true);
    expect(notes).toContain('<untrusted_user_content> label="source"');
    expect(notes.indexOf("Gobbler handle")).toBeGreaterThan(notes.indexOf("GRADUS LIBRARY"));
    expect(notes).toContain("up to 5");
    expect(notes).toContain("Competition result: one move per place the result lost value");
  });

  it("a brief has no guard, no source, and exactly N moves from the library first", () => {
    expect(brief.startsWith("You convert")).toBe(true);
    expect(brief).not.toContain("untrusted_user_content");
    expect(brief).toContain("Write exactly 4 moves");
    expect(brief).toContain("Level: Juvenile");
  });

  it("the intro note is a hook", () => {
    expect(notes).toContain("notes: one line that makes a reader want to try the plan");
  });
});

describe("planImprovePrompt", () => {
  it("carries the principles, the library, the instruction and the current moves", () => {
    const p = planImprovePrompt({
      sportLabel: "Tennis",
      library: [],
      level: "",
      title: "Serve Rhythm",
      notes: "",
      instruction: "make the cues shorter",
      moves: [{ name: "Toss and catch" }],
    });
    expect(p).toContain("Gradus practice plan for Tennis");
    expect(p).toContain("GRADUS LIBRARY for Tennis");
    expect(p).toContain("Instruction: make the cues shorter");
    expect(p).toContain('"Toss and catch"');
    expect(p).toContain("the instruction wins");
  });
});
