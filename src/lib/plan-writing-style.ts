/**
 * Plain-language check for AI-drafted plans: the coaching and physics jargon
 * a draft should not use. There are no word limits (brevity and clarity are
 * priorities, not numbers); `checkPlanStyle` only reports jargon, so a draft
 * that slips can be seen in the server log.
 */

/** Lower-case stems, matched at the start of a word ("establish" catches "established"). */
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

/** Every field of a drafted plan that uses banned jargon. Empty when the plan is clean. */
export function checkPlanStyle(plan: {
  title: string;
  notes: string;
  moves: MoveLike[];
}): PlanStyleViolation[] {
  const out: PlanStyleViolation[] = [];
  const check = (field: string, text: string) => {
    const banned = bannedWordsIn(text);
    if (banned.length) out.push({ field, problem: `banned words: ${banned.join(", ")}` });
  };
  check("title", plan.title);
  check("notes", plan.notes);
  plan.moves.forEach((m, i) => {
    check(`moves[${i}].name`, m.name);
    check(`moves[${i}].description`, m.description);
    check(`moves[${i}].cue`, m.cue);
    check(`moves[${i}].why`, m.why);
  });
  return out;
}
