/**
 * The length and plain-language rules for AI-drafted plans, as numbers and a
 * checker. The prompt that states them to the model is plan-draft-prompt.ts;
 * `checkPlanStyle` measures a draft against the same limits (word counts,
 * banned jargon) without a model call.
 */

/** Word limits per field. `title` counts the plan title, `notes` the intro note. */
export const PLAN_WORD_LIMITS = {
  title: 6,
  name: 5,
  description: 35,
  cue: 6,
  why: 12,
  notes: 20,
} as const;

/** Coaching and physics jargon the drafts must not use. Lower-case stems, matched at the start of a word ("establish" catches "established"). */
export const PLAN_BANNED_WORDS = [
  "trajectory",
  "calibration",
  "calibrate",
  "contrast",
  "mechanics",
  "consistent",
  "consistency",
  "dependable",
  "establish",
  "develop",
  "rollout",
  "launch angle",
] as const;

export type PlanStyleViolation = {
  /** `title`, `notes`, or `moves[2].cue`. */
  field: string;
  problem: string;
};

type MoveLike = { name: string; description: string; cue: string; why: string };

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** The banned stems found in `text`, at the start of a word, case-insensitive. */
export function bannedWordsIn(text: string): string[] {
  const lower = text.toLowerCase();
  return PLAN_BANNED_WORDS.filter((w) => new RegExp(`\\b${w}`).test(lower));
}

/**
 * Every way a drafted plan breaks the writing rules: a field over its word
 * limit, or banned jargon anywhere. Empty when the plan passes.
 */
export function checkPlanStyle(plan: {
  title: string;
  notes: string;
  moves: MoveLike[];
}): PlanStyleViolation[] {
  const out: PlanStyleViolation[] = [];
  const check = (field: string, text: string, limit: number) => {
    const n = countWords(text);
    if (n > limit) out.push({ field, problem: `${n} words, limit ${limit}` });
    const banned = bannedWordsIn(text);
    if (banned.length) out.push({ field, problem: `banned words: ${banned.join(", ")}` });
  };
  check("title", plan.title, PLAN_WORD_LIMITS.title);
  check("notes", plan.notes, PLAN_WORD_LIMITS.notes);
  plan.moves.forEach((m, i) => {
    check(`moves[${i}].name`, m.name, PLAN_WORD_LIMITS.name);
    check(`moves[${i}].description`, m.description, PLAN_WORD_LIMITS.description);
    check(`moves[${i}].cue`, m.cue, PLAN_WORD_LIMITS.cue);
    check(`moves[${i}].why`, m.why, PLAN_WORD_LIMITS.why);
  });
  return out;
}
