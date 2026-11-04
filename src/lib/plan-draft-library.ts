/**
 * "Library wins": when a drafted move is one the sport's Gradus library has,
 * the library's description, cue, why and default target replace the model's,
 * and the move carries the library's name. Pure, so it is tested without a
 * model or a database. The rows come from `seed_moves`, the curriculum every
 * coach's library is seeded from.
 */

export type LibraryMove = {
  name: string;
  category: string;
  description: string;
  cue: string;
  why: string;
  defaultTargetKind: "reps" | "mins";
  defaultTargetValue: number;
};

/**
 * A move as the model returns it: a library name when it matched (then its
 * description holds only what the source adds to the library move), and no
 * target when the source gave none.
 */
export type DraftedMove = {
  libraryName?: string | null;
  name: string;
  description: string;
  cue: string;
  why: string;
  targetKind: "reps" | "mins";
  targetValue: number | null;
};

export type FinalMove = {
  name: string;
  description: string;
  cue: string;
  why: string;
  targetKind: "reps" | "mins";
  targetValue: number;
};

/** The target a move gets when neither the source nor the library gives one. */
export const FALLBACK_TARGET = { targetKind: "reps", targetValue: 10 } as const;

const key = (s: string) => s.trim().toLowerCase();

/** The library by lower-cased name, built once per draft. */
export function libraryIndex(library: LibraryMove[]): Map<string, LibraryMove> {
  return new Map(library.map((m) => [key(m.name), m]));
}

/** The library move the draft names, or the one whose name the draft's own name equals. */
export function findLibraryMove(
  move: DraftedMove,
  index: Map<string, LibraryMove>,
): LibraryMove | null {
  const named = move.libraryName?.trim() ? index.get(key(move.libraryName)) : undefined;
  return named ?? index.get(key(move.name)) ?? null;
}

/**
 * The library's text with the source's addition after it, unless the library
 * already says it. The addition is what the source workout adds to the
 * library move (a constraint, a count, a variation), so a converted plan
 * still shows what the source was.
 */
export function withAddition(libraryText: string, addition: string): string {
  const lib = libraryText.trim();
  const add = addition.trim();
  if (!add) return lib;
  if (!lib) return add;
  if (lib.toLowerCase().includes(add.toLowerCase())) return lib;
  return `${/[.!?]$/.test(lib) ? lib : `${lib}.`} ${add}`;
}

/**
 * Applies the library to every drafted move. A matched move takes the
 * library's name and its description, cue and why, with the source's own
 * addition kept after the library's description; its target is the source's
 * count when the model found one, else the library's default. An unmatched
 * move keeps the model's words and gets the fallback target when the source
 * gave none.
 */
export function applyLibrary(moves: DraftedMove[], library: LibraryMove[]): FinalMove[] {
  const index = libraryIndex(library);
  return moves.map((m) => {
    const lib = findLibraryMove(m, index);
    const kind = m.targetKind === "mins" ? "mins" : "reps";
    const fromSource = m.targetValue != null && Number.isFinite(m.targetValue) && m.targetValue > 0;
    if (!lib) {
      return {
        name: m.name.trim(),
        description: m.description.trim(),
        cue: m.cue.trim(),
        why: m.why.trim(),
        targetKind: fromSource ? kind : FALLBACK_TARGET.targetKind,
        targetValue: fromSource ? Math.round(m.targetValue!) : FALLBACK_TARGET.targetValue,
      };
    }
    return {
      name: lib.name,
      description: withAddition(lib.description, m.description),
      cue: lib.cue.trim() || m.cue.trim(),
      why: lib.why.trim() || m.why.trim(),
      targetKind: fromSource ? kind : lib.defaultTargetKind,
      targetValue: fromSource ? Math.round(m.targetValue!) : lib.defaultTargetValue,
    };
  });
}
