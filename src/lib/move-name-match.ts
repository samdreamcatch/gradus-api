/**
 * Move-name matching for AI move drafts (PRD decision #53). Turns a move
 * name into comparison keys so spellings of the same name meet ("3-Turn",
 * "three turn", "3 turns"; "DB Romanian Deadlifts", "Romanian Deadlift
 * (Dumbbell)"), and ranks near misses. Pure: shared by the draft pipeline
 * (the Gradus library first, then the open exercise list) and
 * scripts/import-exercise-list.ts, which de-duplicates the list with it.
 */

const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
};

const ABBREVIATIONS: Record<string, string[]> = {
  db: ["dumbbell"],
  bb: ["barbell"],
  kb: ["kettlebell"],
  rdl: ["romanian", "deadlift"],
  w: ["with"],
  alternating: ["alternate"],
};

// Spellings the plural rule below gets wrong.
const SINGULARS: Record<string, string> = { flyes: "fly", flies: "fly", flys: "fly" };

const ARTICLES = new Set(["a", "an", "the"]);

function singular(token: string): string {
  if (token.length <= 2 || /^\d/.test(token)) return token;
  if (SINGULARS[token]) return SINGULARS[token];
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (/(ss|sh|ch|x|z)es$/.test(token)) return token.slice(0, -2);
  if (/(ss|us|is)$/.test(token)) return token;
  return token.endsWith("s") ? token.slice(0, -1) : token;
}

/**
 * Lowercase words with case, accents, punctuation, hyphens, "&", small
 * number words, simple plurals, articles and a few gym abbreviations
 * (db, bb, kb, rdl) evened out.
 */
export function nameTokens(name: string): string[] {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&|\+/g, " and ")
    .replace(/['’‘`]/g, "")
    // "3turn" reads as "3 turn"; "2a" (a jump code) stays whole.
    .replace(/(\d)([a-z]{2,})/g, "$1 $2")
    .replace(/([a-z]{2,})(\d)/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ");
  const out: string[] = [];
  for (const word of s.split(" ")) {
    if (!word || ARTICLES.has(word)) continue;
    for (const part of ABBREVIATIONS[word] ?? [word])
      out.push(singular(NUMBER_WORDS[part] ?? part));
  }
  return out;
}

/** Joined without spaces, so "push up" and "pushup" meet. */
const keyOf = (tokens: string[]) => tokens.join("");

/**
 * Every key a name answers to: its words in order, and for a qualified name
 * ("Squat (Barbell)", "Squats - With Bands") the qualifier moved to the
 * front too ("Barbell Squat", "Band Squat"), the open list's two ways of
 * naming equipment.
 */
export function nameKeys(name: string): string[] {
  const keys = new Set<string>();
  const base = keyOf(nameTokens(name));
  if (base) keys.add(base);
  const qualified = name.match(/^(.+?)\s*\(([^()]+)\)\s*$/) ?? name.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (qualified) {
    const [, head, qualifier] = qualified;
    const front = keyOf([
      ...nameTokens(qualifier.replace(/^\s*with\s+/i, "")),
      ...nameTokens(head),
    ]);
    if (front) keys.add(front);
  }
  return [...keys];
}

/** True when two names are the same after normalising (an exact match). */
export function sameMoveName(a: string, b: string): boolean {
  const keys = new Set(nameKeys(a));
  return nameKeys(b).some((k) => keys.has(k));
}

function trigrams(key: string): Set<string> {
  const padded = `  ${key} `;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i += 1) grams.add(padded.slice(i, i + 3));
  return grams;
}

function dice<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/** How alike two names are, 0 to 1: the better of word overlap and letter trigrams. */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  return Math.max(dice(new Set(ta), new Set(tb)), dice(trigrams(keyOf(ta)), trigrams(keyOf(tb))));
}

export interface NamedEntry {
  name: string;
  aliases?: string[];
}

export interface NameMatch<T extends NamedEntry> {
  /** The first entry whose name or alias normalises to the same key. */
  exact: T | null;
  /** Up to `limit` near misses, best first, when there is no exact match. */
  candidates: T[];
}

/** A prepared index over a list, so the per-request work is one pass. */
export class NameIndex<T extends NamedEntry> {
  private readonly byKey = new Map<string, T>();
  private readonly prepared: { entry: T; tokens: Set<string>[]; grams: Set<string>[] }[];

  constructor(entries: readonly T[]) {
    this.prepared = entries.map((entry) => {
      const names = [entry.name, ...(entry.aliases ?? [])];
      for (const n of names) {
        for (const k of nameKeys(n)) if (!this.byKey.has(k)) this.byKey.set(k, entry);
      }
      const tokenLists = names.map(nameTokens);
      return {
        entry,
        tokens: tokenLists.map((t) => new Set(t)),
        grams: tokenLists.map((t) => trigrams(keyOf(t))),
      };
    });
  }

  match(name: string, { limit = 3, minScore = 0.55 } = {}): NameMatch<T> {
    for (const k of nameKeys(name)) {
      const hit = this.byKey.get(k);
      if (hit) return { exact: hit, candidates: [] };
    }
    const tokens = nameTokens(name);
    if (!tokens.length) return { exact: null, candidates: [] };
    const tokenSet = new Set(tokens);
    const grams = trigrams(keyOf(tokens));
    const scored: { entry: T; score: number }[] = [];
    for (const p of this.prepared) {
      let score = 0;
      for (let i = 0; i < p.tokens.length; i += 1) {
        score = Math.max(score, dice(tokenSet, p.tokens[i]), dice(grams, p.grams[i]));
      }
      if (score >= minScore) scored.push({ entry: p.entry, score });
    }
    scored.sort((x, y) => y.score - x.score || x.entry.name.length - y.entry.name.length);
    return { exact: null, candidates: scored.slice(0, limit).map((s) => s.entry) };
  }
}
