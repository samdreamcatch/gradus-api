/**
 * The prompt behind every AI-drafted social plan (admin Social plans page).
 * Written for the reader, not the model: a social plan is posted publicly, so
 * it speaks to "you", names nobody, and fits any sport. The source section is
 * the only part that varies: a coach's lesson notes or a competition result
 * (one button, so one prompt covers both), or a sport/level/focus brief with
 * no source at all. `planImprovePrompt` is the same rules applied to moves an
 * editor wants rewritten.
 *
 * The limits here are the ones `checkPlanStyle` (plan-writing-style.ts)
 * measures, so a draft can be scored without a model call.
 */
import { PROMPT_INJECTION_GUARD, sanitizeUserContent, wrapUntrusted } from "./ai-prompt-safety";
import { PLAN_WORD_LIMITS as L } from "./plan-writing-style";

export type PlanDraftSource =
  /** A coach's lesson notes or a competition result, pasted and/or attached as a file. */
  | { kind: "source"; pastedText: string; maxMoves: number }
  /** No source: sport, level and focus only. */
  | { kind: "brief"; level: string; focus: string; moveCount: number };

/** What a plan is and how each field is written. Shared by every drafter. */
function planShape(sport: string): string {
  return `You write Gradus practice plans for ${sport}. Gradus posts them publicly, so a plan is for anyone in ${sport} who finds it: speak to the reader as "you", name no person, club, team or event, and describe no particular athlete.

The reader is looking at a phone mid-practice. A plan tells them what to do next and nothing else.

A PLAN IS
- title: under ${L.title} words, no emoji.
- notes: one line under ${L.notes} words. What the plan is for, or what comes next.
- moves: in order. Each move is one drill, game, checklist or skill.

EACH MOVE
- name: under ${L.name} words. The coach's name for it when they gave one.
- description: under ${L.description} words. The steps in order, in plain words a ten-year-old reads once. Every count, tool, prop and rule stays; only the words get shorter. Say what to do, not why it works.
- cue: under ${L.cue} words. The one line a coach would call out. The coach's own phrase when they wrote one.
- why: under ${L.why} words. The coach's reason when they gave one; otherwise the usual reason a coach assigns this move. The editor can change it.
- targetKind: "reps" or "mins".
- targetValue: the count or time the coach gave. If none, the number the drill's own structure gives: 4 balls is 4 reps, 3 shots with each of 3 clubs is 9 reps, 3 laps on each foot is 6 reps. A checklist with no count is 5 reps, one run-through each. Never a round number from nowhere.

Plain words. No coaching or physics jargon (trajectory, mechanics, calibration and the like) and no explanation of how equipment works.

HOW A NOTE BECOMES A MOVE
Coach wrote: "edges - 3 laps each foot, knees soft, don't look down"
Move: name "Edges", description "3 laps on each foot. Knees soft.", cue "Don't look down", why "Clean edges carry into every turn.", 6 reps.
The coach's words, sorted into the fields, trimmed. Not rewritten, and not reused for a different note.`;
}

const OUTPUT_SHAPE = `OUTPUT
JSON only: {"title", "notes", "moves": [{"name", "description", "cue", "why", "targetKind", "targetValue"}]}. targetKind is "reps" or "mins"; targetValue is a number.`;

function sourceSection(source: PlanDraftSource, sport: string): string {
  if (source.kind === "brief") {
    return `THE SOURCE
There is no source. Sport: ${sport}. Level: ${source.level || "all levels"}. Focus: ${source.focus || "well-rounded fundamentals"}.
Write exactly ${source.moveCount} moves an athlete can do alone that a coach would assign for that focus. Be specific to ${sport}. Never invent medical claims.`;
  }
  const pasted = source.pastedText.trim()
    ? `\n\n${wrapUntrusted("source", sanitizeUserContent(source.pastedText, 12000))}`
    : "";
  return `THE SOURCE
It is a coach's lesson notes, or a competition result (judges' protocol, score sheet, results text), pasted below and/or attached as a file.
- Lesson notes: one move per drill, game, checklist or skill the coach wrote, in the coach's order, up to ${source.maxMoves}. Fewer is fine. Add nothing the coach did not write. A checklist (set-up, positions, form points) is its own move, with the checklist as the description. What the coach says to work on next time goes in notes, not a move.
- Competition result: one move per place the result lost value (a fall, a downgraded element, a low component, a missed shot, a slow split), up to ${source.maxMoves}. Nothing the result does not show. The why names the element or component.
The source may name people, clubs or events: the plan never does.${pasted}`;
}

/** The whole prompt for a first draft. */
export function planDraftPrompt(opts: { sport: string; source: PlanDraftSource }): string {
  const sport = sanitizeUserContent(opts.sport, 60) || "sport";
  const guard = opts.source.kind === "source" ? `${PROMPT_INJECTION_GUARD}\n\n` : "";
  return [guard + planShape(sport), sourceSection(opts.source, sport), OUTPUT_SHAPE].join("\n\n");
}

/** The whole prompt for rewriting an existing plan's moves on an editor's instruction. */
export function planImprovePrompt(opts: {
  sport: string;
  level: string;
  title: string;
  notes: string;
  instruction: string;
  moves: unknown[];
}): string {
  const sport = sanitizeUserContent(opts.sport, 60) || "sport";
  return [
    planShape(sport),
    `THE SOURCE
An existing plan${opts.level ? ` for level ${sanitizeUserContent(opts.level, 60)}` : ""}${opts.title ? `, titled "${sanitizeUserContent(opts.title, 140)}"` : ""}${opts.notes ? `, with the note "${sanitizeUserContent(opts.notes, 1000)}"` : ""}, and an editor's instruction.
Rewrite every move to follow the instruction. Keep the number and order of moves unless the instruction says otherwise (12 at most), and keep each move's target unless it changes it. Where the instruction conflicts with the rules above, the instruction wins.

Instruction: ${sanitizeUserContent(opts.instruction, 1000)}

Current moves (JSON): ${JSON.stringify(opts.moves)}`,
    `OUTPUT
JSON only: {"moves": [{"name", "description", "cue", "why", "targetKind", "targetValue"}]}. targetKind is "reps" or "mins"; targetValue is a number.`,
  ].join("\n\n");
}
