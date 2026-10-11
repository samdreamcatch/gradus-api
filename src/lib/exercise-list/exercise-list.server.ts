/**
 * The open exercise list (PRD decision #53, step 2): facts about ~900 gym
 * exercises, matched by name for AI move drafts. Server-only so the JSON
 * stays out of the client bundle. Facts only; see SOURCES.md.
 */
import list from "./exercises.json";
import { NameIndex } from "../move-name-match";
import type { ExerciseFacts } from "./types";

export type { ExerciseFacts } from "./types";

let index: NameIndex<ExerciseFacts> | null = null;

/** Built once per isolate, on first use. */
export function exerciseIndex(): NameIndex<ExerciseFacts> {
  index ??= new NameIndex((list as { exercises: ExerciseFacts[] }).exercises);
  return index;
}

/** One exercise's facts as prompt lines (never text from the source). */
export function describeExercise(e: ExerciseFacts): string {
  const parts = [
    `category: ${e.category}`,
    e.equipment.length ? `equipment: ${e.equipment.join(", ")}` : "",
    e.primaryMuscles.length ? `primary muscles: ${e.primaryMuscles.join(", ")}` : "",
    e.secondaryMuscles.length ? `secondary muscles: ${e.secondaryMuscles.join(", ")}` : "",
    e.force ? `force: ${e.force}` : "",
    e.mechanic ? `mechanic: ${e.mechanic}` : "",
    e.level ? `level: ${e.level}` : "",
  ].filter(Boolean);
  const aka = e.aliases?.length ? `\n  also called: ${e.aliases.join(", ")}` : "";
  return `- name: ${e.name}${aka}\n  ${parts.join("; ")}`;
}
