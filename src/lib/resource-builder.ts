/** Pure helpers for the club resource builder (draft shape, PDF-safe text, line wrapping). */

export type BuilderSection = { heading: string; body: string };
export type BuilderDraft = { title: string; summary: string; sections: BuilderSection[] };

const REPLACE: Record<string, string> = {
  "\u2018": "'", "\u2019": "'", "\u201C": '"', "\u201D": '"',
  "\u2013": "-", "\u2014": "-", "\u2026": "...", "\u00A0": " ", "\u2022": "-",
};

/** The built-in PDF fonts only cover basic Latin; swap or drop anything else. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201C\u201D\u2013\u2014\u2026\u00A0\u2022]/g, (c) => REPLACE[c] ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\n\x20-\x7E]/g, "");
}

/** Greedy word wrap; `measure` returns a string's width in points. */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (measure(next) <= maxWidth || !line) line = next;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}
