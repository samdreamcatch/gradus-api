/**
 * Chunking for the knowledge corpus (PRD §6.7 "Grounded Ask Gradus", L4).
 *
 * Pure functions, no I/O, so the chunkers can be tested against real page
 * text. Two strategies, chosen per source (`knowledge_sources.chunker`):
 *
 *  - `prose`: the default. Paragraphs are accumulated up to `maxChars`,
 *    each chunk carries the most recent heading as its `section`, and the
 *    tail of one chunk is repeated at the head of the next (`overlapChars`)
 *    so a sentence split by the boundary is still findable.
 *  - `rules`: for rulebooks. A numbered clause ("3.14", "2.1.3", "SR 3.10",
 *    "Rule 4") is the unit. Small consecutive clauses are merged up to
 *    `maxChars`; a clause longer than that is split as prose but keeps its
 *    clause number as the section. Headings are ALL-CAPS lines or lines
 *    starting with Chapter/Part/Section/Rule/Appendix.
 *
 * PDF text has no table structure (pdf.js hands back runs of text), so
 * "keep tables whole" is approximated: a run of short numeric lines is
 * never split from the clause it follows. Chunk quality is measured by
 * docs/knowledge/known-answers.json through the admin panel, not by eye.
 */
import { createHash } from "crypto";

export type PageText = { page: number; text: string };

export type Chunk = {
  ordinal: number;
  /** Page where the chunk starts (1-based), null for inline text sources. */
  page: number | null;
  section: string;
  content: string;
  tokenEstimate: number;
  contentHash: string;
};

export type Chunker = "prose" | "rules";

export type ChunkOptions = {
  maxChars?: number;
  overlapChars?: number;
  minChars?: number;
};

const DEFAULTS: Required<ChunkOptions> = { maxChars: 1400, overlapChars: 200, minChars: 40 };

/** Stable identity of a chunk's text; a re-ingest with identical text yields identical hashes. */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Normalize extracted page text: strip control characters, mend words
 * hyphenated across a line break, collapse spaces, and keep paragraph
 * breaks (blank lines) intact.
 */
export function normalizePageText(raw: string): string {
  let s = raw.replace(/\r\n?/g, "\n");
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ");
  s = s.replace(/(\w)-\n(?=[a-z])/g, "$1"); // develop-\nment → development
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/ *\n */g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

type Block = { page: number | null; text: string; heading: boolean };

const HEADING_WORDS = /^(chapter|part|section|rule|appendix|article)\b/i;

/** A short line with no sentence punctuation that looks like a title. */
export function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 80) return false;
  if (/[.!?;:]$/.test(t)) return false;
  if (HEADING_WORDS.test(t)) return true;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 4 && letters === letters.toUpperCase()) return true;
  // Title Case: most words capitalized, few words.
  const words = t.split(/\s+/);
  if (words.length <= 8) {
    const capped = words.filter((w) => /^[A-Z]/.test(w)).length;
    if (capped >= Math.ceil(words.length * 0.75) && !/\d{3,}/.test(t)) return true;
  }
  return false;
}

/** Split normalized pages into paragraph blocks, flagging headings. */
function toBlocks(pages: PageText[]): Block[] {
  const blocks: Block[] = [];
  for (const p of pages) {
    const text = normalizePageText(p.text);
    if (!text) continue;
    for (const para of text.split(/\n\n+/)) {
      const lines = para
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (!lines.length) continue;
      // A heading line that opens a paragraph is its own block.
      if (lines.length > 1 && looksLikeHeading(lines[0]!)) {
        blocks.push({ page: p.page, text: lines[0]!, heading: true });
        blocks.push({ page: p.page, text: lines.slice(1).join(" "), heading: false });
      } else if (lines.length === 1 && looksLikeHeading(lines[0]!)) {
        blocks.push({ page: p.page, text: lines[0]!, heading: true });
      } else {
        blocks.push({ page: p.page, text: lines.join(" "), heading: false });
      }
    }
  }
  return blocks;
}

function finish(
  out: Chunk[],
  page: number | null,
  section: string,
  parts: string[],
  minChars: number,
): void {
  const content = parts.join("\n\n").trim();
  if (content.length < minChars) return;
  out.push({
    ordinal: out.length,
    page,
    section,
    content,
    tokenEstimate: estimateTokens(content),
    contentHash: contentHash(content),
  });
}

/** Split one long paragraph on sentence boundaries into pieces ≤ maxChars. */
function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]?\s*|[^.!?]+$/g) ?? [text];
  const pieces: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur.length + s.length > maxChars && cur) {
      pieces.push(cur.trim());
      cur = "";
    }
    if (s.length > maxChars) {
      // No sentence boundary to use: hard-split on words.
      const words = s.split(" ");
      for (const w of words) {
        if (cur.length + w.length + 1 > maxChars && cur) {
          pieces.push(cur.trim());
          cur = "";
        }
        cur += w + " ";
      }
    } else {
      cur += s;
    }
  }
  if (cur.trim()) pieces.push(cur.trim());
  return pieces;
}

/** The tail of a chunk that is repeated at the start of the next one. */
function overlapTail(parts: string[], overlapChars: number): string[] {
  if (overlapChars <= 0) return [];
  const tail: string[] = [];
  let len = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!;
    if (len + p.length > overlapChars && tail.length) break;
    tail.unshift(p);
    len += p.length;
    if (len >= overlapChars) break;
  }
  return tail;
}

export function chunkProse(pages: PageText[], opts: ChunkOptions = {}): Chunk[] {
  const { maxChars, overlapChars, minChars } = { ...DEFAULTS, ...opts };
  const out: Chunk[] = [];
  let section = "";
  let parts: string[] = [];
  let page: number | null = null;
  let carried = 0; // how many leading parts are overlap from the previous chunk

  for (const b of toBlocks(pages)) {
    if (b.heading) {
      finish(out, page, section, parts, minChars);
      parts = [];
      carried = 0;
      page = null;
      section = b.text;
      continue;
    }
    for (const piece of splitLong(b.text, maxChars)) {
      const cur = parts.join("\n\n").length;
      if (cur + piece.length + 2 > maxChars && parts.length > carried) {
        finish(out, page, section, parts, minChars);
        const tail = overlapTail(parts, overlapChars);
        parts = [...tail];
        carried = tail.length;
        page = b.page;
      }
      if (page === null) page = b.page;
      parts.push(piece);
    }
  }
  finish(out, page, section, parts, minChars);
  return out;
}

const CLAUSE_START =
  /^(?:(?:[A-Z]{1,4}\s?)?\d{1,4}(?:\.\d{1,3}){0,3}|Rule\s+\d+[A-Za-z]?)[.)]?\s+\S/;

/** Split pages into clauses: a clause runs from one clause-start line to the next. */
function toClauses(pages: PageText[]): Array<{ page: number; label: string; text: string }> {
  const clauses: Array<{ page: number; label: string; text: string }> = [];
  let cur: { page: number; label: string; lines: string[] } | null = null;
  const flush = () => {
    if (cur && cur.lines.length) {
      clauses.push({ page: cur.page, label: cur.label, text: cur.lines.join(" ") });
    }
    cur = null;
  };
  for (const p of pages) {
    const text = normalizePageText(p.text);
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      if (looksLikeHeading(line) && !CLAUSE_START.test(line)) {
        flush();
        clauses.push({ page: p.page, label: "", text: line });
        continue;
      }
      if (CLAUSE_START.test(line)) {
        flush();
        const label = line.match(/^(\S+(?:\s\d[\d.]*)?)/)?.[1] ?? "";
        cur = { page: p.page, label, lines: [line] };
        continue;
      }
      if (!cur) cur = { page: p.page, label: "", lines: [] };
      cur.lines.push(line);
    }
  }
  flush();
  return clauses;
}

export function chunkRules(pages: PageText[], opts: ChunkOptions = {}): Chunk[] {
  const { maxChars, minChars } = { ...DEFAULTS, ...opts };
  const out: Chunk[] = [];
  let section = "";
  let parts: string[] = [];
  let page: number | null = null;
  let firstLabel = "";

  const flush = () => {
    finish(out, page, firstLabel ? `${section} ${firstLabel}`.trim() : section, parts, minChars);
    parts = [];
    page = null;
    firstLabel = "";
  };

  for (const c of toClauses(pages)) {
    const isHeading = !c.label && looksLikeHeading(c.text);
    if (isHeading) {
      flush();
      section = c.text;
      continue;
    }
    if (c.text.length > maxChars) {
      flush();
      const pieces = splitLong(c.text, maxChars);
      pieces.forEach((piece, i) => {
        parts = [piece];
        page = c.page;
        firstLabel = c.label ? `${c.label}${i ? ` (cont. ${i + 1})` : ""}` : "";
        flush();
      });
      continue;
    }
    const cur = parts.join("\n\n").length;
    if (cur + c.text.length + 2 > maxChars && parts.length) flush();
    if (page === null) page = c.page;
    if (!firstLabel && c.label) firstLabel = c.label;
    parts.push(c.text);
  }
  flush();
  return out;
}

export function chunkPages(pages: PageText[], chunker: Chunker, opts: ChunkOptions = {}): Chunk[] {
  return chunker === "rules" ? chunkRules(pages, opts) : chunkProse(pages, opts);
}

/** Inline text sources arrive as one string; treat it as a single un-numbered page. */
export function chunkText(text: string, chunker: Chunker, opts: ChunkOptions = {}): Chunk[] {
  return chunkPages([{ page: 0, text }], chunker, opts).map((c) => ({ ...c, page: null }));
}
