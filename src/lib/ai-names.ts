/**
 * Names out of AI prompts (App Review 2026-10-12; the parent consent line
 * "Gradus anonymizes your athlete's name before a summary is sent to Google").
 *
 * `createNameMask` swaps every known name in a prompt for a placeholder such
 * as `[ATHLETE]`, and `unmask` puts the display name back into the model's
 * reply. Callers load the names (src/lib/ai-names.server.ts), mask the whole
 * prompt (the name fields Gradus adds AND the notes, messages and recaps
 * people typed), and unmask every string they keep.
 *
 * Matching:
 * - a full name ("Sarah Kim") matches in any case;
 * - a first name matches in any case, unless it is also an everyday word
 *   ("Will", "Grace"): then only the capitalized or all-caps form, so
 *   "you will" stays readable;
 * - a last name matches in any case too, unless it is an everyday word: then
 *   only capitalized or all caps ("Hill", not "hill sprints"). It gets its own
 *   `[SURNAME n]` placeholder so a family name shared by athlete and parent
 *   restores correctly;
 * - accents, apostrophes and hyphens don't matter ("jose" for José, O’Brien
 *   for O'Brien, "Anne Marie" for Anne-Marie);
 * - possessives keep their "'s" ("[ATHLETE]'s");
 * - each part of a two-part first name matches on its own ("Kate" for a
 *   Mary Kate), after any person whose whole first name it is;
 * - `unmask` writes back the shortest form the text used ("Sarah" over
 *   "Sarah Kim"), or the person's display name when the prompt never named them.
 *
 * With `fuzzy`, a word spelled like a first name is masked too ("Lynnea" for
 * "Linnea", "Sara" for "Sarah"); nicknames are not caught.
 */

export type NameRole = "ATHLETE" | "PARENT" | "COACH";

export interface MaskPerson {
  role: NameRole;
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  /** What `unmask` writes back for this person (default: the first name). */
  display?: string;
}

export interface NameMask {
  /** `{ fuzzy: false }` for typed names such as move titles, where only exact names count. */
  mask(text: string, opts?: NameMaskOptions): string;
  /** Each input person's placeholder, in input order ("" when the person had no usable name). */
  personTokens: string[];
  unmask(text: string): string;
  /** The placeholder used for the first person of `role` (e.g. "[ATHLETE]"). */
  token(role: NameRole): string;
}

/** First names that are also everyday English words: matched only when capitalized. */
const EVERYDAY_WORD_NAMES = new Set([
  "will",
  "grace",
  "hope",
  "faith",
  "joy",
  "summer",
  "may",
  "june",
  "april",
  "august",
  "autumn",
  "winter",
  "rose",
  "lily",
  "ivy",
  "dawn",
  "eve",
  "mark",
  "bill",
  "pat",
  "sue",
  "ray",
  "art",
  "rich",
  "rob",
  "nick",
  "jack",
  "frank",
  "chase",
  "hunter",
  "mason",
  "piper",
  "river",
  "sky",
  "skye",
  "sage",
  "wren",
  "honey",
  "sunny",
  "star",
  "page",
  "drew",
  "gene",
  "guy",
  "destiny",
  "harmony",
  "melody",
  "liberty",
  "journey",
  "haven",
  "brook",
  "cash",
  "king",
  "major",
  "royal",
  "bishop",
  "rocky",
  "rusty",
  "dusty",
  "buddy",
  "sandy",
  "holly",
  "heather",
  "jade",
  "ruby",
  "pearl",
  "amber",
  "crystal",
  "iris",
  "daisy",
  "violet",
  "olive",
  "hazel",
  "ginger",
  "penny",
  "angel",
  "gale",
  "miles",
  "max",
  "rex",
  "lane",
  "reed",
  "cole",
  "dean",
  "earl",
  "glen",
  "grant",
  "heath",
  "jay",
  "lance",
  "neil",
  "park",
  "pierce",
  "price",
  "ward",
  "wade",
  "young",
  "sterling",
  "blaze",
  "storm",
  "rain",
  "ocean",
  "lake",
  "forest",
]);

/** Surnames that are also everyday words: matched only when capitalized ("Hill", not "hill sprints"). */
const EVERYDAY_WORD_SURNAMES = new Set([
  ...EVERYDAY_WORD_NAMES,
  "hill",
  "brown",
  "white",
  "green",
  "black",
  "gray",
  "grey",
  "wood",
  "woods",
  "stone",
  "field",
  "fields",
  "long",
  "short",
  "little",
  "small",
  "rich",
  "bell",
  "bush",
  "cook",
  "baker",
  "miller",
  "smith",
  "hunt",
  "fox",
  "wolf",
  "bird",
  "swan",
  "crane",
  "parks",
  "rivers",
  "banks",
  "brooks",
  "lee",
  "best",
  "good",
  "love",
  "sharp",
  "strong",
  "may",
  "day",
  "knight",
  "rice",
  "page",
  "booth",
  "hall",
  "house",
  "street",
  "west",
  "north",
  "south",
  "east",
  "moon",
  "frost",
  "snow",
  "summers",
  "winters",
  "spring",
  "march",
  "cross",
  "church",
  "chapel",
  "mills",
  "power",
  "glass",
  "gold",
  "silver",
  "steel",
  "iron",
  "case",
  "beck",
  "ford",
  "nash",
  "lord",
  "pope",
  "dove",
]);

/**
 * Capitalized words a dictated plan is full of: the fuzzy pass never takes
 * them for a misspelled name ("The" or "Then" with a Theo on the roster,
 * "Start" with a Stuart, "Flip" with a Filip, "May" with a Mai). A roster name
 * spelled exactly is still masked.
 */
const DICTATION_WORDS = new Set([
  "okay",
  "alright",
  "yeah",
  "the",
  "then",
  "they",
  "them",
  "there",
  "these",
  "those",
  "after",
  "also",
  "again",
  "every",
  "even",
  "like",
  "back",
  "next",
  "first",
  "last",
  "start",
  "finish",
  "plan",
  "core",
  "need",
  "been",
  "nine",
  "very",
  "never",
  "open",
  "try",
  "want",
  "set",
  "sets",
  "land",
  "less",
  "fine",
  "find",
  "line",
  "call",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "test",
  "tests",
  "axel",
  "axels",
  "lutz",
  "flip",
  "flips",
  "loop",
  "loops",
  "salchow",
  "waltz",
  "walley",
  "toe",
  "spin",
  "spins",
  "spiral",
  "spirals",
  "mohawk",
  "mohawks",
  "choctaw",
  "choctaws",
  "harness",
  "pole",
  "camel",
  "layback",
  "twizzle",
  "twizzles",
  "ski",
]);

/**
 * Lower-case words that share a spelling key with a first name ("body" with a
 * Bodie, "trip" with a Tripp): the fuzzy pass leaves them alone in lower case
 * only, since "Body" could still be speech-to-text writing a Bodie.
 */
const LOWER_CASE_WORDS = new Set(["body", "trip", "mini", "rider", "tailor"]);

/**
 * A first name's spelling key, equal for the ways speech-to-text spells one
 * name: accents and case folded, ph→f, ck→k, y→i, a silent h after a vowel
 * dropped ("Sarah", "John"), doubled consonants collapsed, and an -ie or -ey
 * ending read as -y. "Linnea", "Lynnea", "Linea" and "Linnéa" share a key,
 * as do "Katie", "Katey" and "Katy". Doubled vowels are kept, so "Been" is
 * not "Ben".
 */
export function nameSpellingKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}]/gu, "")
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/y/g, "i")
    .replace(/([aeiou])h(?![aeiou])/g, "$1")
    .replace(/([^aeiou])\1+/g, "$1")
    .replace(/(?:ie|ei)$/, "i");
}

const LETTER = "[\\p{L}\\p{N}]";

/** Accented forms of each base letter, so "jose" matches "José" and "Jose" matches "Jóse". */
const ACCENTS: Record<string, string> = {
  a: "aàáâãäåāăą",
  c: "cçćč",
  e: "eèéêëēėęě",
  i: "iìíîïīį",
  n: "nñńň",
  o: "oòóôõöøō",
  u: "uùúûüūůű",
  y: "yýÿ",
  s: "sśšş",
  z: "zźżž",
  g: "gğ",
  l: "lł",
  r: "rř",
  d: "dď",
  t: "tť",
};

/** One name character as a regex piece: accent-insensitive letters, any apostrophe, space or hyphen. */
function charPattern(c: string, caseInsensitive: boolean): string {
  if (/['’ʼ`]/.test(c)) return "['’ʼ`]";
  if (/[\s-]/.test(c)) return "[\\s-]+";
  const base = c.normalize("NFD").replace(/\p{M}/gu, "");
  const variants = ACCENTS[base.toLowerCase()];
  if (!variants) return escapeRegExp(c);
  const upper = !caseInsensitive && c !== c.toLowerCase();
  return `[${upper ? variants.toUpperCase() : variants}]`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clean(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ");
}

function capitalizedForms(name: string): string[] {
  const cap = name.charAt(0).toLocaleUpperCase() + name.slice(1);
  return [...new Set([name, cap, name.toLocaleUpperCase()])];
}

interface Rule {
  re: RegExp;
  token: string;
  length: number;
  /** A part of a two-part first name: loses a tie to a whole name. */
  part: boolean;
}

function rule(name: string, token: string, caseInsensitive: boolean, part = false): Rule {
  const body = [...name].map((c) => charPattern(c, caseInsensitive)).join("");
  return {
    re: new RegExp(`(?<!${LETTER})${body}(?!${LETTER})`, caseInsensitive ? "giu" : "gu"),
    token,
    length: name.length,
    part,
  };
}

interface FuzzyFirst {
  name: string;
  key: string;
  variants: string[];
  token: string;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) {
      cur[j + 1] = Math.min(cur[j] + 1, prev[j + 1] + 1, prev[j] + (a[i] === b[j] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export interface NameMaskOptions {
  /**
   * Also mask words speech-to-text could have written for a first name: the
   * same spelling key ("Lynnea" for "Linnea", `nameSpellingKey`), or, for a
   * capitalized word, one edit away from a name of four letters or more (two
   * from seven letters: "Sara" for "Sarah"). A three-letter name ending in
   * "e" also takes -y and -ie ("Zoey" for "Zoe"). A lower-case word of four
   * letters or more and an everyday word match by key only ("lynnea", "Lily"
   * for a Lilly; never "Will" for a Willa, never "lily"), and common
   * dictation words are left alone.
   */
  fuzzy?: boolean;
}

export function createNameMask(people: MaskPerson[], opts: NameMaskOptions = {}): NameMask {
  const personTokens: string[] = [];
  const fuzzyFirsts: FuzzyFirst[] = [];
  /** Parts of two-part first names, tried after every whole first name. */
  const fuzzyParts: FuzzyFirst[] = [];
  /** The text each placeholder first replaced, so `unmask` restores it as written. */
  const seen = new Map<string, string>();
  const rules: Rule[] = [];
  const displays = new Map<string, string>();
  const firstToken = new Map<NameRole, string>();
  const counts = new Map<NameRole, number>();
  const surnameTokens = new Map<string, string>();

  const addFirst = (first: string, token: string, part: boolean) => {
    if (first.length >= 3) {
      const name = first.toLocaleLowerCase();
      const plain = name.normalize("NFD").replace(/\p{M}/gu, "");
      // "Zoey" and "Zoie" for a Zoe: spelled out, since the key would also take "Joy" for a Joe.
      const variants =
        plain.length === 3 && plain.endsWith("e") ? [`${plain}y`, `${plain.slice(0, 2)}ie`] : [];
      (part ? fuzzyParts : fuzzyFirsts).push({
        name,
        key: nameSpellingKey(first),
        variants,
        token,
      });
    }
    if (EVERYDAY_WORD_NAMES.has(first.toLocaleLowerCase())) {
      for (const form of capitalizedForms(first)) rules.push(rule(form, token, false, part));
    } else {
      rules.push(rule(first, token, true, part));
    }
  };

  for (const p of people) {
    const first = clean(p.firstName);
    const last = clean(p.lastName);
    if (first.length < 2 && last.length < 2) {
      personTokens.push("");
      continue;
    }
    const n = (counts.get(p.role) ?? 0) + 1;
    counts.set(p.role, n);
    const token = n === 1 ? `[${p.role}]` : `[${p.role} ${n}]`;
    if (n === 1) firstToken.set(p.role, token);
    displays.set(token, p.display ?? (first || last));
    personTokens.push(token);

    if (first.length >= 2 && last.length >= 2) rules.push(rule(`${first} ${last}`, token, true));
    if (first.length >= 2) {
      addFirst(first, token, false);
      const parts = first.split(/[\s-]+/).filter((part) => part.length >= 2);
      if (parts.length > 1) for (const part of parts) addFirst(part, token, true);
    }
    if (last.length >= 2) {
      const key = last.toLocaleLowerCase();
      let surname = surnameTokens.get(key);
      if (!surname) {
        surname = `[SURNAME ${surnameTokens.size + 1}]`;
        surnameTokens.set(key, surname);
        displays.set(surname, last);
      }
      if (EVERYDAY_WORD_SURNAMES.has(key)) {
        for (const form of capitalizedForms(last)) rules.push(rule(form, surname, false));
      } else {
        rules.push(rule(last, surname, true));
      }
    }
  }
  // Longest first, so "Sarah Kim" wins over "Sarah"; a Kate's own name over a Mary Kate's part.
  rules.sort((a, b) => b.length - a.length || Number(a.part) - Number(b.part));
  const fuzzyNames = [...fuzzyFirsts, ...fuzzyParts];

  const tokenList = [...displays.keys()].sort((a, b) => b.length - a.length);
  const unmaskRes = tokenList.map((t) => ({
    token: t,
    re: new RegExp(escapeRegExp(t).replace(/^\\\[/, "\\[\\s*").replace(/\\\]$/, "\\s*\\]"), "gi"),
  }));
  // Restore the shortest form written ("Sarah" over "Sarah Kim"); a fuzzy
  // match ("Sara") only when the name never appeared spelled right.
  const fuzzySeen = new Map<string, string>();
  const fold = (t: string) =>
    t
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/['’ʼ`]/g, "'")
      .replace(/[\s-]+/g, " ")
      .toLowerCase();
  const remember = (token: string, original: string, fuzzy = false) => {
    // The stored spelling wins over a variant of it ("José", not "jose").
    const display = displays.get(token);
    const form = display && fold(display) === fold(original) ? display : original;
    const store = fuzzy ? fuzzySeen : seen;
    const prior = store.get(token);
    if (
      prior === undefined ||
      form.length < prior.length ||
      (form === display && form.length === prior.length)
    ) {
      store.set(token, form);
    }
    return token;
  };

  return {
    personTokens,
    mask(text, maskOpts) {
      let out = text;
      for (const r of rules) out = out.replace(r.re, (m) => remember(r.token, m));
      if ((maskOpts?.fuzzy ?? opts.fuzzy) && fuzzyNames.length) {
        out = out.replace(/(?<![\p{L}\p{N}[])\p{L}{3,}(?![\p{L}\p{N}])/gu, (word) => {
          const w = word.toLocaleLowerCase();
          if (DICTATION_WORDS.has(w)) return word;
          const capitalized = /^\p{Lu}/u.test(word);
          // Lower case: "lynnea" yes, "lily" or "body" no.
          if (
            !capitalized &&
            (w.length < 4 || EVERYDAY_WORD_NAMES.has(w) || LOWER_CASE_WORDS.has(w))
          ) {
            return word;
          }
          // Same spelling key first, so "John" goes to a Jon before a Joan.
          // Only a capitalized word that is no everyday one goes on to edit
          // distance: "Lily" is a Lilly, "Will" is no Willa.
          const key = nameSpellingKey(w);
          let match = fuzzyNames.find((f) => f.key === key || f.variants.includes(w));
          if (!match && capitalized && !EVERYDAY_WORD_NAMES.has(w)) {
            match = fuzzyNames.find((f) => {
              // Three-letter names match on the key only.
              const limit = f.name.length >= 7 ? 2 : f.name.length >= 4 ? 1 : 0;
              return (
                limit > 0 &&
                Math.abs(f.name.length - w.length) <= limit &&
                levenshtein(f.name, w) <= limit
              );
            });
          }
          return match ? remember(match.token, word, true) : word;
        });
      }
      return out;
    },
    unmask(text) {
      let out = text;
      for (const u of unmaskRes) {
        out = out.replace(
          u.re,
          seen.get(u.token) ?? fuzzySeen.get(u.token) ?? displays.get(u.token)!,
        );
      }
      return out;
    },
    token(role) {
      return firstToken.get(role) ?? `[${role}]`;
    },
  };
}

/** Appended to a masked prompt so the model keeps the placeholders as written. */
export const NAME_PLACEHOLDER_NOTE =
  "Names are replaced with placeholders in square brackets, such as [ATHLETE], [PARENT] or [COACH]. Refer to people only by these placeholders, exactly as written, and never guess a real name.";

/** Unmasks every string inside a model's structured reply (objects and arrays, any depth). */
export function unmaskStrings<T>(value: T, unmask: (s: string) => string): T {
  if (typeof value === "string") return unmask(value) as T;
  if (Array.isArray(value)) return value.map((v) => unmaskStrings(v, unmask)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        unmaskStrings(v, unmask),
      ]),
    ) as T;
  }
  return value;
}
