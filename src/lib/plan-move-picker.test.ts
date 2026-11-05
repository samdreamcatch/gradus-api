import { describe, expect, it } from "bun:test";
import { pickerMoves } from "./plan-move-picker";

const moves = [
  {
    sport: "figure_skating",
    name: "Forward stroking",
    category: "Basics",
    cue: "Push from the inside edge",
  },
  { sport: "tennis", name: "Forehand", category: "Basics", cue: "Low to high" },
  { sport: "tennis", name: "Kick serve", category: "Serve", cue: "Toss behind" },
];

describe("pickerMoves", () => {
  it("returns everything on All with no search", () => {
    expect(pickerMoves(moves, "", "")).toEqual(moves);
  });
  it("keeps only the chip's sport", () => {
    expect(pickerMoves(moves, "tennis", "").map((m) => m.name)).toEqual(["Forehand", "Kick serve"]);
  });
  it("applies the sport before the search, so a shared category name stays inside the sport", () => {
    expect(pickerMoves(moves, "tennis", "basics").map((m) => m.name)).toEqual(["Forehand"]);
  });
  it("searches name, category and cue, case-insensitively", () => {
    expect(pickerMoves(moves, "", "TOSS").map((m) => m.name)).toEqual(["Kick serve"]);
  });
});
