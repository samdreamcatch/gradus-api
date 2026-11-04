/**
 * Writing rules for AI-drafted plans that families read on a phone between
 * shots or run-throughs. Shared by the admin social-plan drafters
 * (`social-plans.functions.ts`): the rules go at the END of each prompt so
 * they win over the field guidance above them, and the one example is short
 * because a model copies an example more faithfully than it obeys a limit.
 *
 * `checkPlanStyle` is the same rules as a checker, so a draft can be measured
 * (word counts, banned jargon) without a model call.
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

/** Length and plain-language rules, with the example. Every plan drafter appends this. */
export const PLAN_WRITING_STYLE = `## Writing style: this is read on the range, mid-practice

The reader is a parent or young athlete holding a phone between shots.
They will glance, not read. Every word must earn its place.

Hard length limits (count them):
- Plan title: ${PLAN_WORD_LIMITS.title} words max.
- Move name: ${PLAN_WORD_LIMITS.name} words max.
- Description: ${PLAN_WORD_LIMITS.description} words max. Short imperative sentences. Say what to DO, not why it works. Short means fewer words, not fewer steps: keep every step, count, club, ball and prop the coach gave.
- Cue: ${PLAN_WORD_LIMITS.cue} words max. Something you could shout across the range.
- Why: ${PLAN_WORD_LIMITS.why} words max, one plain sentence. Leave it empty if it would just repeat the description.
- Plan notes: ${PLAN_WORD_LIMITS.notes} words max.

Plain language:
- Write at a 5th-grade reading level.
- Use the coach's own words and props ("no click," "Gobbler handle," "his favorite high shot"). Do not swap them for generic equivalents.
- Never use: ${PLAN_BANNED_WORDS.join(", ")}, or similar coaching jargon.
- No explanations of physics or equipment design.
- The cue must not repeat a sentence from the description.

Example (for length and tone only; it is a different sport, so never reuse its words)
Too long (47 words): "Begin at the baseline with a basket of balls and have your partner feed you a gentle ball to the forehand side. Split-step as the ball is fed, turn your shoulders early and swing from low to high so that the ball clears the net with topspin."

Right:
Name: Crosscourt Forehands
Description: Partner feeds 20 balls to your forehand. Split-step, turn early, swing low to high. Aim deep crosscourt.
Cue: Low to high.
Why: Topspin keeps it in.`;

/**
 * Rules for drafts made FROM a coach's notes or a result. The sport/level/
 * focus drafter has no source to stay close to, so it leaves these out.
 */
export const PLAN_FIDELITY_RULES = `Stay close to the source:
- Make one move per drill, game, or problem the source describes. Do not invent extra moves to fill out a session. Fewer moves is fine.
- Use the coach's rep counts or minutes when the source gives them. When it gives none, use 10 reps; never make up a larger number.
- Things the coach says to work on later or next time go in the plan notes, not in a move.
- A setup or checklist the coach wrote is its own first move: the move name is what it sets up, the description is the checklist in the coach's order ("Narrow stance. Ball just back. Hands ahead. Small swing, no click."), the cue is its shortest line.
- A game or drill keeps its structure: how many balls or reps, which clubs or tools, in what order, and what changes between rounds.`;

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
