/**
 * The prompt behind every AI-drafted social plan (admin Social plans page).
 *
 * What the feature is: an admin takes an existing workout in another medium
 * (notes, a PDF, a picture, a results sheet) and converts it into a Gradus
 * plan to post publicly. The plan is the pitch, so it has to show what that
 * workout looks like when it is clear and usable: it speaks to anyone in the
 * sport, names nobody, and reads like Gradus's own library. Where the library
 * has the move, the library's wording wins; the server copies those fields in
 * (`applyLibrary`, plan-draft-library.ts), so the model's job there is only
 * to name the match.
 *
 * No word limits: brevity, clarity and plain language are the standing
 * priorities, and the library sets the tone.
 */
import { PROMPT_INJECTION_GUARD, sanitizeUserContent, wrapUntrusted } from "./ai-prompt-safety";
import type { LibraryMove } from "./plan-draft-library";

export type PlanDraftSource =
  /** A coach's lesson notes or a competition result, pasted and/or attached as a file. */
  | { kind: "source"; pastedText: string; maxMoves: number }
  /** No source: sport, level and focus only. */
  | { kind: "brief"; level: string; focus: string; moveCount: number };

/** How many library moves the prompt lists; a sport's seed set is well under this. */
export const LIBRARY_PROMPT_LIMIT = 200;

function principles(sportLabel: string): string {
  return `You convert an existing workout into a Gradus practice plan for ${sportLabel}. Gradus posts the plan publicly to show what a workout looks like when it is clear and easy to use. It speaks to the reader as "you", names no person, club, team or event, and describes no particular athlete.

Clarity first. Say each thing once, in the fewest plain words that still say it, in language a ten-year-old reads once. Minimize jargon. Never explain physics or how equipment works.

A PLAN IS
- title: short, no emoji.
- notes: one line that makes a reader want to try the plan. Context a single move can't hold (what a game was, what comes next) goes here.
- moves: in order. Each move is one discrete drill or skill. A game in the source is split into the moves it exercises.

EACH MOVE
- libraryName: the exact name from the GRADUS LIBRARY below when the move is one the library has, else null. The library's description, cue and why are used for that move, so match whenever you honestly can.
- name: the library's name; else the source's name for it; else the shortest plain name.
- description: what the move is and how it is done. Set-up points (stance, grip, position, where to stand) belong here, inside the move they set up. A set-up checklist is never a move of its own. On a library match, write here only what the source adds to the library move (a constraint, a count, a variation), in one short sentence, or nothing.
- cue: the few words a parent says in the moment to bring the coach's instruction back, or the coach's own words. Useful on its own; not a repeat of the description.
- why: why this move matters or gets assigned. The coach's reason when they gave one; otherwise the usual reason. The editor can change it.
- targetKind: "reps" or "mins".
- targetValue: the count or time the source gives, or the number the drill's own structure gives (3 shots with each of 3 clubs is 9 reps; 2 laps on each foot is 4 reps). Otherwise null. Never a number from nowhere.`;
}

/**
 * The sport's library as the model sees it. A draft gets each move's
 * description too, since it has to tell a match from a near miss; an improve
 * only needs the names, so it lists those (finding: the full list cost tokens
 * for nothing there).
 */
function librarySection(
  sportLabel: string,
  library: LibraryMove[],
  detail: "full" | "names",
): string {
  if (!library.length) {
    return `GRADUS LIBRARY for ${sportLabel}
The library has no moves for this sport. Leave libraryName null and write every field yourself, in the style above.`;
  }
  const rows = library
    .slice(0, LIBRARY_PROMPT_LIMIT)
    .map((m) =>
      detail === "names"
        ? `- ${m.name}`
        : `- ${m.name} | ${m.category}${m.description ? ` | ${sanitizeUserContent(m.description, 160)}` : ""}`,
    )
    .join("\n");
  return detail === "names"
    ? `GRADUS LIBRARY for ${sportLabel} (move names; use these names for moves the library has)
${rows}`
    : `GRADUS LIBRARY for ${sportLabel} (name | category | what it is)
${rows}`;
}

function sourceSection(source: PlanDraftSource, sportLabel: string): string {
  if (source.kind === "brief") {
    return `THE SOURCE
There is no source. Sport: ${sportLabel}. Level: ${sanitizeUserContent(source.level, 80) || "all levels"}. Focus: ${sanitizeUserContent(source.focus, 200) || "well-rounded fundamentals"}.
Write exactly ${source.moveCount} moves an athlete can do alone that a coach would assign for that focus, drawing on the library first. Never invent medical claims.`;
  }
  const pasted = source.pastedText.trim()
    ? `\n\n${wrapUntrusted("source", sanitizeUserContent(source.pastedText, 12000))}`
    : "";
  return `THE SOURCE
It is a coach's lesson notes or workout, or a competition result (judges' protocol, score sheet, results text), pasted below and/or attached as a file.
- Lesson notes or workout: one move per discrete drill or skill the source holds, in the source's order, up to ${source.maxMoves}. Fewer is fine. Add no drill the source doesn't have. Set-up points go into the move they set up. What the source says to work on next time goes in notes, not a move.
- Competition result: one move per place the result lost value (a fall, a downgraded element, a low component, a missed shot, a slow split), up to ${source.maxMoves}. Nothing the result does not show. The why names the element or component.
The source may name people, clubs or events: the plan never does.${pasted}`;
}

const OUTPUT_SHAPE = `OUTPUT
JSON only: {"title", "notes", "moves": [{"libraryName", "name", "description", "cue", "why", "targetKind", "targetValue"}]}. libraryName is a string or null; targetKind is "reps" or "mins"; targetValue is a number or null.`;

/** The whole prompt for a first draft. */
export function planDraftPrompt(opts: {
  sportLabel: string;
  library: LibraryMove[];
  source: PlanDraftSource;
}): string {
  const sport = sanitizeUserContent(opts.sportLabel, 60) || "this sport";
  const guard = opts.source.kind === "source" ? `${PROMPT_INJECTION_GUARD}\n\n` : "";
  return [
    guard + principles(sport),
    librarySection(sport, opts.library, "full"),
    sourceSection(opts.source, sport),
    OUTPUT_SHAPE,
  ].join("\n\n");
}

/** The whole prompt for rewriting an existing plan's moves on an editor's instruction. */
export function planImprovePrompt(opts: {
  sportLabel: string;
  library: LibraryMove[];
  level: string;
  title: string;
  notes: string;
  instruction: string;
  moves: unknown[];
}): string {
  const sport = sanitizeUserContent(opts.sportLabel, 60) || "this sport";
  return [
    principles(sport),
    librarySection(sport, opts.library, "names"),
    `THE SOURCE
An existing plan${opts.level ? ` for level ${sanitizeUserContent(opts.level, 60)}` : ""}${opts.title ? `, titled "${sanitizeUserContent(opts.title, 140)}"` : ""}${opts.notes ? `, with the note "${sanitizeUserContent(opts.notes, 1000)}"` : ""}, and an editor's instruction.
Rewrite every move to follow the instruction. Keep the number and order of moves unless the instruction says otherwise (12 at most), and keep each move's target unless it changes it. Where the instruction conflicts with the rules above, the instruction wins.

Instruction: ${sanitizeUserContent(opts.instruction, 1000)}

Current moves (JSON): ${JSON.stringify(opts.moves)}`,
    `OUTPUT
JSON only: {"moves": [{"name", "description", "cue", "why", "targetKind", "targetValue"}]}. targetKind is "reps" or "mins"; targetValue is a number.`,
  ].join("\n\n");
}
