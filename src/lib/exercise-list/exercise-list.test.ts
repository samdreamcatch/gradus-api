import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { buildExerciseList, serialiseExerciseList } from "../../../scripts/import-exercise-list";
import { describeExercise, exerciseIndex } from "./exercise-list.server";
import { EXERCISE_FACT_KEYS, type ExerciseFacts } from "./types";

const FILE = new URL("./exercises.json", import.meta.url);
const text = readFileSync(FILE, "utf8");
const data = JSON.parse(text) as { sources: unknown[]; exercises: ExerciseFacts[] };

// Instruction text from these sources matches Bodybuilding.com's pages and
// the images were scraped (SOURCES.md): none of it may ever be committed.
const FORBIDDEN =
  /^(instructions?|description|tips?|images?|video|videos|license|license_author)$/i;

function forbiddenKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => forbiddenKeys(v, `${path}[${i}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(FORBIDDEN.test(k) ? [`${path}.${k}`] : []),
    ...forbiddenKeys(v, `${path}.${k}`),
  ]);
}

describe("committed exercise list (facts only)", () => {
  it("never carries instructions, descriptions, tips, images, video or a license", () => {
    expect(forbiddenKeys(data)).toEqual([]);
    for (const word of ["instructions", "description", "tips", "images", "video", "license"]) {
      expect(text.includes(`"${word}"`)).toBe(false);
    }
    // The one CC-BY-SA entry upstream (wger), skipped by the import.
    expect(data.exercises.some((e) => e.name === "Dumbbell Skullcrusher")).toBe(false);
  });

  it("holds only the fact fields, each short and well typed", () => {
    const allowed = new Set<string>(EXERCISE_FACT_KEYS);
    for (const e of data.exercises) {
      for (const key of Object.keys(e)) expect(allowed.has(key)).toBe(true);
      expect(typeof e.name).toBe("string");
      expect(typeof e.category).toBe("string");
      for (const list of [e.equipment, e.primaryMuscles, e.secondaryMuscles, e.aliases ?? []]) {
        expect(Array.isArray(list)).toBe(true);
        for (const s of list) expect(typeof s).toBe("string");
      }
      // A sentence of instructions would never fit a fact field.
      const strings = [e.name, e.category, e.force, e.mechanic, e.level, ...(e.aliases ?? [])];
      for (const s of strings) if (s) expect(s.length).toBeLessThanOrEqual(120);
      for (const s of [...e.equipment, ...e.primaryMuscles, ...e.secondaryMuscles]) {
        expect(s.length).toBeLessThanOrEqual(40);
      }
    }
  });

  it("is sorted, unique by name, pinned to upstream commits, and small", () => {
    const names = data.exercises.map((e) => e.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    expect(new Set(names).size).toBe(names.length);
    expect(data.exercises.length).toBeGreaterThan(800);
    expect(JSON.stringify(data.sources)).toMatch(/"commit":"[0-9a-f]{40}"/);
    expect(text.length).toBeLessThan(220_000);
  });

  it("finds an exercise by name, alias or abbreviation", () => {
    expect(exerciseIndex().match("romanian deadlifts").exact?.name).toBe("Romanian Deadlift");
    expect(exerciseIndex().match("Negative Crunch").exact?.name).toBe("Decline Crunch");
    expect(exerciseIndex().match("Waltz jump").exact).toBeNull();
  });
});

describe("buildExerciseList", () => {
  const fedb = [
    {
      id: "Barbell_Lunge",
      name: "Barbell Lunge",
      category: "strength",
      equipment: "barbell",
      primaryMuscles: ["quadriceps"],
      secondaryMuscles: ["glutes"],
      force: "push",
      mechanic: "compound",
      level: "intermediate",
      instructions: ["Step forward with one leg."],
      images: ["Barbell_Lunge/0.jpg"],
    },
  ];
  const exercemus = {
    exercises: [
      {
        name: "Barbell Lunges",
        aliases: ["Weighted Lunge"],
        category: "strength",
        equipment: ["barbell"],
        primary_muscles: ["quads"],
        secondary_muscles: [],
        instructions: ["Step forward."],
        tips: ["Stay tall."],
        video: "https://example.com/v.mp4",
      },
      {
        name: "Copied Curl",
        category: "strength",
        equipment: ["dumbbell"],
        primary_muscles: ["biceps"],
        secondary_muscles: [],
        description: "Someone else's words.",
        license: { short_name: "CC-BY-SA 3" },
        license_author: "someone",
      },
      {
        name: "Machine Dip",
        category: "strength",
        equipment: ["none"],
        primary_muscles: ["abs"],
        secondary_muscles: [],
        instructions: ["Press down."],
      },
    ],
  };

  it("keeps facts only, skips licensed entries, and merges duplicates as aliases", () => {
    const { exercises, stats } = buildExerciseList(fedb, exercemus);
    expect(stats).toEqual({ kept: 2, merged: 1, skipped: 1 });
    expect(exercises).toEqual([
      {
        name: "Barbell Lunge",
        aliases: ["Weighted Lunge"],
        category: "strength",
        equipment: ["barbell"],
        primaryMuscles: ["quadriceps"],
        secondaryMuscles: ["glutes"],
        force: "push",
        mechanic: "compound",
        level: "intermediate",
      },
      {
        name: "Machine Dip",
        category: "strength",
        equipment: ["body only"],
        primaryMuscles: ["abdominals"],
        secondaryMuscles: [],
      },
    ]);
    const out = serialiseExerciseList(exercises);
    expect(forbiddenKeys(JSON.parse(out))).toEqual([]);
    expect(out).not.toContain("Step forward");
    expect(out).not.toContain("Copied Curl");
  });

  it("describes an exercise from its facts alone", () => {
    const lines = describeExercise(buildExerciseList(fedb, { exercises: [] }).exercises[0]);
    expect(lines).toBe(
      "- name: Barbell Lunge\n  category: strength; equipment: barbell; primary muscles: quadriceps; secondary muscles: glutes; force: push; mechanic: compound; level: intermediate",
    );
  });
});
