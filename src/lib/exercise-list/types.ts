/**
 * One exercise in the open exercise list (PRD decision #53): facts only,
 * never instruction text. See SOURCES.md for where they come from.
 */
export interface ExerciseFacts {
  name: string;
  aliases?: string[];
  /** strength, stretching, plyometrics, cardio, … */
  category: string;
  equipment: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  /** push, pull or static. */
  force?: string;
  /** compound or isolation. */
  mechanic?: string;
  /** beginner, intermediate or expert. */
  level?: string;
}

/** The only keys an entry may carry; the purity test holds the committed file to it. */
export const EXERCISE_FACT_KEYS = [
  "name",
  "aliases",
  "category",
  "equipment",
  "primaryMuscles",
  "secondaryMuscles",
  "force",
  "mechanic",
  "level",
] as const satisfies readonly (keyof ExerciseFacts)[];
