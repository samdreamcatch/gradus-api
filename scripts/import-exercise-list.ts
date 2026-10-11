/**
 * Builds src/lib/exercise-list/exercises.json, the open exercise list behind
 * AI move drafts (PRD decision #53, step 2 of 3). `bun scripts/import-exercise-list.ts`.
 *
 * FACTS ONLY: name, aliases, category, equipment, muscles, force, mechanic
 * and level. The upstream instruction text matches Bodybuilding.com's pages
 * nearly word for word and the images were scraped, so `instructions`,
 * `description`, `tips`, `images` and `video` are never read into the output,
 * and an entry carrying its own `license` (one CC-BY-SA entry from wger) is
 * skipped. See src/lib/exercise-list/SOURCES.md. The commits are pinned so a
 * re-run reproduces the file; bump them deliberately.
 *
 * src/lib/exercise-list/exercise-list.test.ts fails if the committed file
 * ever carries one of those fields or a licensed entry.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nameKeys } from "../src/lib/move-name-match";
import type { ExerciseFacts } from "../src/lib/exercise-list/types";

export const SOURCES = [
  {
    repo: "yuhonas/free-exercise-db",
    commit: "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5",
    path: "dist/exercises.json",
    license: "Unlicense",
  },
  {
    repo: "exercemus/exercises",
    commit: "0ee5b742928b0c910883fa1c0c2cfaf26c4ee180",
    path: "exercises.json",
    license: "MIT (code); entries with their own license field are skipped",
  },
] as const;

const MAX_NAME = 120;

// Upstream vocabularies differ; free-exercise-db's wins.
const MUSCLES: Record<string, string> = { abs: "abdominals", quads: "quadriceps" };
const EQUIPMENT: Record<string, string> = {
  none: "body only",
  kettlebell: "kettlebells",
  "ez curl bar": "e-z curl bar",
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim() : undefined;

const strList = (v: unknown, map: Record<string, string> = {}): string[] => {
  const list = Array.isArray(v) ? v : v == null ? [] : [v];
  const out = list
    .map(str)
    .filter((s): s is string => !!s && s.length <= MAX_NAME)
    .map((s) => map[s.toLowerCase()] ?? s.toLowerCase());
  return [...new Set(out)];
};

/** The fact fields of one upstream entry, or null to skip it. */
function facts(raw: unknown, shape: "free-exercise-db" | "exercemus"): ExerciseFacts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if ("license" in r || "license_author" in r) return null;
  const name = str(r.name);
  if (!name || name.length > MAX_NAME) return null;
  const category = str(r.category)?.toLowerCase();
  if (!category) return null;
  const entry: ExerciseFacts = {
    name,
    category,
    equipment: strList(r.equipment, EQUIPMENT).filter((e) => e !== "other"),
    primaryMuscles: strList(shape === "exercemus" ? r.primary_muscles : r.primaryMuscles, MUSCLES),
    secondaryMuscles: strList(
      shape === "exercemus" ? r.secondary_muscles : r.secondaryMuscles,
      MUSCLES,
    ),
  };
  const aliases = (Array.isArray(r.aliases) ? r.aliases : [])
    .map(str)
    .filter((a): a is string => !!a && a.length <= MAX_NAME);
  if (aliases.length) entry.aliases = [...new Set(aliases)];
  for (const key of ["force", "mechanic", "level"] as const) {
    const v = str(r[key])?.toLowerCase();
    if (v) entry[key] = v;
  }
  return entry;
}

async function download(source: (typeof SOURCES)[number]): Promise<unknown> {
  const url = `https://raw.githubusercontent.com/${source.repo}/${source.commit}/${source.path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export type ImportStats = { kept: number; merged: number; skipped: number };

/** De-duplicates by normalised name; the first source wins and the rest add aliases. */
export function buildExerciseList(
  fedb: unknown,
  exercemus: unknown,
): { exercises: ExerciseFacts[]; stats: ImportStats } {
  const stats: ImportStats = { kept: 0, merged: 0, skipped: 0 };
  const byKey = new Map<string, ExerciseFacts>();
  const exercises: ExerciseFacts[] = [];

  const add = (entry: ExerciseFacts | null) => {
    if (!entry) {
      stats.skipped += 1;
      return;
    }
    const names = [entry.name, ...(entry.aliases ?? [])];
    const keys = names.flatMap(nameKeys);
    const existing = keys.map((k) => byKey.get(k)).find(Boolean);
    if (existing) {
      stats.merged += 1;
      const known = new Set([existing.name, ...(existing.aliases ?? [])].flatMap(nameKeys));
      for (const n of names) {
        if (nameKeys(n).some((k) => known.has(k))) continue;
        existing.aliases = [...(existing.aliases ?? []), n];
        for (const k of nameKeys(n)) known.add(k);
      }
      for (const k of keys) if (!byKey.has(k)) byKey.set(k, existing);
      return;
    }
    stats.kept += 1;
    exercises.push(entry);
    for (const k of keys) if (!byKey.has(k)) byKey.set(k, entry);
  };

  for (const raw of Array.isArray(fedb) ? fedb : []) add(facts(raw, "free-exercise-db"));
  const list = (exercemus as { exercises?: unknown })?.exercises;
  for (const raw of Array.isArray(list) ? list : []) add(facts(raw, "exercemus"));

  for (const e of exercises) {
    if (e.aliases) e.aliases.sort((a, b) => a.localeCompare(b, "en"));
  }
  exercises.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return { exercises, stats };
}

/** One entry per line: small, and a re-import diffs by exercise. */
export function serialiseExerciseList(exercises: ExerciseFacts[]): string {
  const header = {
    $comment:
      "Generated by scripts/import-exercise-list.ts. Facts only (name, aliases, category, equipment, muscles, force, mechanic, level); never instructions, descriptions, tips, images or video. See SOURCES.md.",
    // "repoLicense", not "license": the purity test bans a license key anywhere in the file.
    sources: SOURCES.map(({ repo, commit, license }) => ({ repo, commit, repoLicense: license })),
  };
  const head = JSON.stringify(header).slice(0, -1);
  return `${head},"exercises":[\n${exercises.map((e) => JSON.stringify(e)).join(",\n")}\n]}\n`;
}

if (import.meta.main) {
  const [fedb, exercemus] = await Promise.all(SOURCES.map(download));
  const { exercises, stats } = buildExerciseList(fedb, exercemus);
  const text = serialiseExerciseList(exercises);
  const out = fileURLToPath(new URL("../src/lib/exercise-list/exercises.json", import.meta.url));
  writeFileSync(out, text);
  console.log(
    `Wrote ${out}: ${exercises.length} exercises, ${Buffer.byteLength(text)} bytes ` +
      `(${stats.kept} kept, ${stats.merged} merged as aliases, ${stats.skipped} skipped).`,
  );
}
