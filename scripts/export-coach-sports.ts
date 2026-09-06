/**
 * Writes the coach sport catalog to docs/api/vectors/coach-sports.json so
 * the native app ships the same keys, labels, levels, and suggested hours
 * (PRD §9.1 contract files). `bun scripts/export-coach-sports.ts`;
 * src/lib/coach-sports.test.ts fails when the file drifts from the source.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_SUGGESTED_HOURS, SPORTS } from "../src/lib/coach-sports";

export const COACH_SPORTS_VECTOR = {
  $comment:
    "Generated from src/lib/coach-sports.ts by scripts/export-coach-sports.ts. Keys are stored in the database and never change; labels are display-only. `alwaysSecondary` keys never count toward the primary-sport cap.",
  defaultSuggestedHours: DEFAULT_SUGGESTED_HOURS,
  alwaysSecondary: ["strength_conditioning"],
  sports: SPORTS,
};

if (import.meta.main) {
  const out = resolve(import.meta.dir, "../docs/api/vectors/coach-sports.json");
  writeFileSync(out, `${JSON.stringify(COACH_SPORTS_VECTOR, null, 2)}\n`);
  console.log(`Wrote ${out}`);
}
