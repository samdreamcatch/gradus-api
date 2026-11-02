/** Pure helpers for the club resource builder (draft shape, PDF-safe text, line wrapping). */

export type BuilderSection = { heading: string; body: string };
export type BuilderDraft = { title: string; summary: string; sections: BuilderSection[] };

const REPLACE: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2026": "...",
  "\u00A0": " ",
  "\u2022": "-",
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
export function wrapLines(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (measure(next) <= maxWidth || !line) line = next;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

export type BrandFont = "sans" | "serif" | "mono";
export type PdfBranding = {
  primaryColor: string;
  secondaryColor: string;
  headingFont: BrandFont;
  bodyFont: BrandFont;
  headerText: string;
  footerText: string;
  logoPath: string | null;
};
export const DEFAULT_BRANDING: PdfBranding = {
  primaryColor: "#C0DD27",
  secondaryColor: "#6B7280",
  headingFont: "serif",
  bodyFont: "sans",
  headerText: "",
  footerText: "",
  logoPath: null,
};

/** "#RRGGBB" → 0..1 channels; anything malformed falls back to the given default. */
export function hexToUnit(hex: string, fallback = DEFAULT_BRANDING.primaryColor): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim()) ?? /^#([0-9a-f]{6})$/i.exec(fallback)!;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Header line: the club's own text when set, otherwise the club name. Footer adds page numbers. */
export function brandHeader(b: Pick<PdfBranding, "headerText">, clubName: string) {
  return b.headerText.trim() || clubName;
}
export function brandFooter(b: Pick<PdfBranding, "footerText">, clubName: string, page: number, total: number) {
  return `${b.footerText.trim() || clubName} - ${page} of ${total}`;
}
