import { describe, expect, it } from "bun:test";
import {
  STARTER_PROGRAMS,
  resolveStarterPrograms,
  staleStarterTitles,
  starterMoveCopy,
  starterTitlesForSport,
} from "./starter-programs";

const LOWER = ["basic_skills", "pre_preliminary", "preliminary", "pre_juvenile", "juvenile"];

describe("starter programs by level", () => {
  it("gives every figure skating level its own program, not Juvenile's", () => {
    const titles = LOWER.map((level) => resolveStarterPrograms("figure_skating", level)[0]?.title);
    expect(titles).toEqual([
      "Basic Skills — Free Skate",
      "Pre-Preliminary — Free Skate",
      "Preliminary — Free Skate",
      "Pre-Juvenile — Free Skate",
      "Juvenile — Free Skate",
    ]);
  });

  it("keeps the lower levels within their jump limits", () => {
    const names = (level: string) =>
      resolveStarterPrograms("figure_skating", level).flatMap((p) => p.moves.map((m) => m.name));
    for (const level of ["basic_skills", "pre_preliminary", "preliminary", "pre_juvenile"]) {
      for (const name of names(level)) {
        expect(name).not.toMatch(/Triple|Quad|Double Axel/);
      }
    }
    for (const name of names("basic_skills").concat(names("pre_preliminary"))) {
      expect(name).not.toMatch(/Double/);
    }
    // Juvenile: double axel allowed, no triples.
    for (const name of names("juvenile")) {
      expect(name).not.toMatch(/Triple|Quad/);
    }
  });

  it("seeds every figure skating level in the catalog, across all three tracks", async () => {
    const { SPORTS } = await import("../lib/coach-sports");
    const fs = SPORTS.find((s) => s.key === "figure_skating")!;
    for (const level of fs.levels) {
      expect(resolveStarterPrograms("figure_skating", level.key).length).toBeGreaterThan(0);
    }
    const names = (level: string) =>
      resolveStarterPrograms("figure_skating", level).flatMap((p) => p.moves.map((m) => m.name));
    expect(names("excel_beginner").concat(names("adult_bronze"))).not.toContain("Single Axel");
    for (const name of names("adult_bronze")) expect(name).not.toMatch(/Double|Axel/);
    expect(names("adult_silver")).toContain("Single Axel");
  });

  it("produces nothing for an unmapped level instead of falling back to Juvenile", () => {
    expect(resolveStarterPrograms("figure_skating", "made_up")).toEqual([]);
    expect(resolveStarterPrograms("dance", "beginner")).toEqual([]);
  });

  it("uses a unique title per program, so a plan's program can be read back from it", () => {
    // Tracks share programs (Excel Juvenile seeds the Juvenile program), so
    // dedupe by program key first: distinct programs never share a title.
    const programs = new Map(
      Object.values(STARTER_PROGRAMS.figure_skating!)
        .flat()
        .map((p) => [p.key, p.title] as const),
    );
    const titles = Array.from(programs.values());
    expect(new Set(titles).size).toBe(titles.length);
    expect(starterTitlesForSport("figure_skating").size).toBe(titles.length);
  });

  it("gives every beginner move real coaching copy, not the generic fallback", () => {
    const generic = starterMoveCopy("Something Unknown").cue;
    for (const level of LOWER) {
      for (const move of resolveStarterPrograms("figure_skating", level).flatMap((p) => p.moves)) {
        expect(move.cue).not.toBe(generic);
      }
    }
  });

  it("flags a seeded plan from another level as stale, never the current one or a coach plan", () => {
    const existing = ["Juvenile — Free Skate", "Tuesday jumps"];
    expect(staleStarterTitles(existing, "figure_skating", "preliminary")).toEqual([
      "Juvenile — Free Skate",
    ]);
    expect(staleStarterTitles(existing, "figure_skating", "juvenile")).toEqual([]);
    expect(staleStarterTitles(existing, "dance", "beginner")).toEqual([]);
  });
});
