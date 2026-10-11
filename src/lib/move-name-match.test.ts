import { describe, expect, it } from "bun:test";
import { NameIndex, nameKeys, nameSimilarity, nameTokens, sameMoveName } from "./move-name-match";

describe("sameMoveName", () => {
  const same: [string, string][] = [
    // case, punctuation, hyphens, digits and number words, plurals
    ["Three-Turn", "3 turn"],
    ["3-turns", "three turns"],
    ["3turn", "3 Turn"],
    ["Push-Ups", "pushup"],
    ["Romanian Deadlifts", "romanian deadlift"],
    ["Incline Dumbbell Flyes", "incline dumbbell flies"],
    ["Bicycle crunches", "Bicycle Crunch"],
    ["Lutzes", "lutz"],
    // "&" and "and", apostrophes, accents, articles
    ["Clean & Jerk", "clean and jerk"],
    ["Farmer's Walk", "farmers walk"],
    ["Plié", "plie"],
    ["Squat to a Bench", "squat to bench"],
    // abbreviations
    ["DB Romanian Deadlift", "Dumbbell Romanian Deadlift"],
    ["RDL", "Romanian Deadlift"],
    ["KB swings", "Kettlebell Swing"],
    ["BB row", "Barbell Row"],
    // the list's "Name (Equipment)" and "Name - With Equipment" orderings
    ["Front Squat (Barbell)", "Barbell Front Squat"],
    ["Squats - With Bands", "Band Squat"],
    ["Squats - With Bands", "squat with bands"],
  ];
  for (const [a, b] of same) {
    it(`"${a}" = "${b}"`, () => {
      expect(sameMoveName(a, b)).toBe(true);
      expect(sameMoveName(b, a)).toBe(true);
    });
  }

  const different: [string, string][] = [
    ["Toe loop", "Toe loop jump"],
    ["2A", "2Lz"],
    ["Lunge", "Barbell Lunge"],
    ["Waltz jump", "Half loop"],
    ["", ""],
  ];
  for (const [a, b] of different) {
    it(`"${a}" ≠ "${b}"`, () => expect(sameMoveName(a, b)).toBe(false));
  }
});

describe("nameTokens and nameKeys", () => {
  it("normalises to plain lowercase words", () => {
    expect(nameTokens("The DB Farmer's Walks & Carries")).toEqual([
      "dumbbell",
      "farmer",
      "walk",
      "and",
      "carry",
    ]);
  });

  it("keeps a jump code whole and splits a number from a word", () => {
    expect(nameTokens("2A")).toEqual(["2a"]);
    expect(nameTokens("3turn")).toEqual(["3", "turn"]);
  });

  it("adds the qualifier-first key only for a qualified name", () => {
    expect(nameKeys("Barbell Squat")).toEqual(["barbellsquat"]);
    expect(nameKeys("Squat (Barbell)")).toEqual(["squatbarbell", "barbellsquat"]);
  });
});

describe("nameSimilarity", () => {
  it("is 1 for the same words and 0 for nothing shared", () => {
    expect(nameSimilarity("Barbell Lunge", "lunges, barbell")).toBe(1);
    expect(nameSimilarity("Axel", "Plank")).toBe(0);
  });
});

describe("NameIndex", () => {
  const index = new NameIndex([
    { name: "Barbell Lunge", tag: 1 },
    { name: "Dumbbell Lunges", tag: 2 },
    { name: "Bodyweight Walking Lunge", tag: 3 },
    { name: "Decline Crunch", aliases: ["Negative Crunch"], tag: 4 },
    { name: "Cable Crossover", tag: 5 },
    { name: "Plank", tag: 6 },
  ]);

  it("matches exactly on a name or an alias, with no candidates", () => {
    expect(index.match("negative crunches")).toEqual({
      exact: { name: "Decline Crunch", aliases: ["Negative Crunch"], tag: 4 },
      candidates: [],
    });
    expect(index.match("PLANKS").exact?.tag).toBe(6);
  });

  it("offers close candidates (at most three), best first, when nothing matches exactly", () => {
    const lunge = index.match("lunge");
    expect(lunge.exact).toBeNull();
    expect(lunge.candidates.map((c) => c.tag)).toEqual([1, 2]);
    expect(index.match("crossovers").candidates.map((c) => c.tag)).toEqual([5]);
  });

  it("offers nothing for an unrelated or empty name", () => {
    expect(index.match("Waltz jump")).toEqual({ exact: null, candidates: [] });
    expect(index.match("  ")).toEqual({ exact: null, candidates: [] });
  });
});
