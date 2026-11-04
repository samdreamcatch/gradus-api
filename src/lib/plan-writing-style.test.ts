import { describe, expect, it } from "bun:test";
import { bannedWordsIn, checkPlanStyle, countWords } from "./plan-writing-style";

/** The target shape from the handoff for the bump & run notes (about 90 words). */
const GOOD_PLAN = {
  title: "Bump & Run: Low vs. High",
  notes: "Next up: control distance with club choice and swing length.",
  moves: [
    {
      name: "Bump & Run Setup",
      description:
        "Narrow stance. Ball just behind center. Hands just ahead of the ball. Keep the swing small with no wrist click.",
      cue: "Small swing, no click.",
      why: "",
    },
    {
      name: "Low/High Gobbler Game",
      description:
        "4 balls. Hit bump & runs with SW, PW and 8-iron, each below the Gobbler handle. Ball 4: your favorite high shot, over it.",
      cue: "Under the handle, then over.",
      why: "Feel how each club flies and rolls.",
    },
  ],
};

/** A move in the long style the handoff complained about. */
const LONG_MOVE = {
  name: "High Shot Over the Barrier",
  description:
    "Switch to a sand wedge and practice hitting higher shots that fly safely over the waist-high barrier. Stand with your feet slightly wider apart and make a smooth swing so the club's natural angle launches the ball high into the air and lets it land softly.",
  cue: "Wider stance, smooth swing, let the loft work.",
  why: "Builds trajectory contrast so he can choose the right shot for each lie.",
};

describe("checkPlanStyle", () => {
  it("passes the handoff's target plan", () => {
    expect(checkPlanStyle(GOOD_PLAN)).toEqual([]);
    const total =
      countWords(GOOD_PLAN.title) +
      countWords(GOOD_PLAN.notes) +
      GOOD_PLAN.moves.reduce(
        (n, m) =>
          n +
          countWords(m.name) +
          countWords(m.description) +
          countWords(m.cue) +
          countWords(m.why),
        0,
      );
    expect(total).toBeLessThan(100);
  });

  it("flags the long style by field, with the count and the jargon", () => {
    const violations = checkPlanStyle({
      title: "Bump and Run Trajectory and Distance Control",
      notes:
        "The athlete has established the core setup and wrist mechanics for low trajectory shots. This session builds trajectory contrast and dials in distance control through multi-club selection and swing length calibration.",
      moves: [LONG_MOVE],
    });
    const fields = violations.map((v) => v.field);
    expect(fields).toContain("title");
    expect(fields).toContain("notes");
    expect(fields).toContain("moves[0].description");
    expect(fields).toContain("moves[0].cue");
    expect(fields).toContain("moves[0].why");
    const problems = (field: string) =>
      violations
        .filter((v) => v.field === field)
        .map((v) => v.problem)
        .join("; ");
    expect(problems("moves[0].description")).toBe("46 words, limit 35");
    expect(problems("title")).toBe("7 words, limit 6; banned words: trajectory");
    expect(problems("notes")).toBe(
      "31 words, limit 20; banned words: trajectory, calibration, contrast, mechanics, establish",
    );
    expect(problems("moves[0].why")).toContain("trajectory, contrast");
  });

  it("matches banned stems at the start of a word, case-insensitively", () => {
    expect(bannedWordsIn("Hold a CONSISTENT tempo")).toEqual(["consistent"]);
    expect(bannedWordsIn("a contrasting colour")).toEqual(["contrast"]);
    expect(bannedWordsIn("we established the setup")).toEqual(["establish"]);
    expect(bannedWordsIn("a cue card")).toEqual([]);
    expect(bannedWordsIn("watch the launch angle")).toEqual(["launch angle"]);
  });

  it("counts words across whitespace and treats blanks as empty", () => {
    expect(countWords("  Small swing,  no click. ")).toBe(4);
    expect(countWords("   ")).toBe(0);
  });
});
