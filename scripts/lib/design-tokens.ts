/**
 * Platform-neutral design-token export, per docs/ios/PRD.md §8.2 and §9.1.
 *
 * Reads the `@theme inline`, `:root`, and `.dark` blocks of src/styles.css
 * (parsed with postcss), resolves `var()` references and
 * `color-mix(in oklab, …)`, converts every OKLCH color to sRGB the way
 * browsers render it (per-channel clipping, verified against Chrome), and
 * returns a JSON-ready object.
 * `scripts/export-design-tokens.ts` writes it to docs/api/design-tokens.json;
 * `gradus-ios` vendors that file and generates its color catalog from it, so
 * web and iOS never disagree on a color.
 *
 * The export is total: a token the converter does not understand lands in
 * `raw` as its resolved CSS text instead of failing the build, and `null`
 * always means "not defined in this mode". Output is deterministic (code
 * point sorted keys, fixed precision, no timestamp) so CI can diff it.
 */
import postcss, { type AtRule, type Rule } from "postcss";

export interface Srgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ColorValue {
  /** `#RRGGBB`, or `#RRGGBBAA` when alpha < 1. */
  hex: string;
  /** sRGB components in 0…1 (clipped like browsers do), alpha in 0…1. */
  srgb: Srgb;
  /** The resolved CSS expression this was converted from. */
  css: string;
}

export interface ThemedColor {
  light: ColorValue | null;
  dark: ColorValue | null;
}

export interface ThemedNumber {
  light: number | null;
  dark: number | null;
}

export interface ThemedRaw {
  light: string | null;
  dark: string | null;
}

export interface DesignTokens {
  $comment: string;
  source: string;
  fonts: Record<string, string[]>;
  radii: Record<string, number>;
  /** Tailwind-facing aliases (`--color-*`) → the semantic token they reference. */
  colorAliases: Record<string, string>;
  colors: Record<string, ThemedColor>;
  numbers: Record<string, ThemedNumber>;
  /** Tokens the converter could not classify, as resolved CSS text. */
  raw: Record<string, ThemedRaw>;
}

type Declarations = Map<string, string>;

function normalizeValue(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts `--name: value;` declarations from a top-level block. `selector`
 * is a rule selector (`:root`, `.dark`) or an at-rule (`@theme inline`).
 */
export function extractBlock(css: string, selector: string): Declarations {
  const root = postcss.parse(css);
  let block: Rule | AtRule | undefined;
  root.each((node) => {
    if (block) return;
    if (node.type === "rule" && node.selector.trim() === selector) block = node;
    else if (node.type === "atrule" && `@${node.name} ${node.params}`.trim() === selector)
      block = node;
  });
  if (!block) throw new Error(`design-tokens: block "${selector}" not found`);

  const out: Declarations = new Map();
  block.each((child) => {
    if (child.type === "decl" && child.prop.startsWith("--")) {
      out.set(child.prop.slice(2), normalizeValue(child.value));
    }
  });
  return out;
}

/** Splits on `sep` at parenthesis depth zero. */
function splitTopLevel(input: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Recursively substitutes `var(--x)` (with optional fallback) from `scope`. */
export function resolveValue(value: string, scope: Declarations, seen: string[] = []): string {
  let out = "";
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf("var(", i);
    if (at === -1) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, at);
    // Find the matching close paren.
    let depth = 0;
    let j = at + 3;
    for (; j < value.length; j++) {
      if (value[j] === "(") depth++;
      if (value[j] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const inner = value.slice(at + 4, j);
    const [ref, ...fallbackParts] = splitTopLevel(inner, ",");
    const name = ref.trim().replace(/^--/, "");
    if (seen.includes(name)) throw new Error(`design-tokens: cycle at --${name}`);
    const referenced = scope.get(name);
    if (referenced === undefined) {
      if (fallbackParts.length === 0) throw new Error(`design-tokens: unresolved --${name}`);
      out += resolveValue(fallbackParts.join(","), scope, seen);
    } else {
      out += resolveValue(referenced, scope, [...seen, name]);
    }
    i = j + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Color math (Björn Ottosson's OKLab ↔ linear sRGB matrices).
// ---------------------------------------------------------------------------

interface Oklab {
  L: number;
  a: number;
  b: number;
  alpha: number;
}

type Linear = [number, number, number];

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function linearToGamma(c: number): number {
  const v = clamp01(c);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function gammaToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function oklabToLinear({ L, a, b }: Oklab): Linear {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function linearToOklab([lr, lg, lb]: Linear, alpha: number): Oklab {
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha,
  };
}

export function srgbToOklab({ r, g, b, a }: Srgb): Oklab {
  return linearToOklab([gammaToLinear(r), gammaToLinear(g), gammaToLinear(b)], a);
}

/**
 * OKLab → sRGB (gamma encoded). Out-of-gamut channels are clipped per
 * channel. CSS Color 4 specifies OKLCH chroma reduction instead, but no
 * shipping browser implements it: Chrome, Safari, and Firefox all clip, and
 * the values below are verified against Chrome (see the test table), so
 * clipping is what keeps iOS identical to what the web actually renders.
 */
export function oklabToSrgb(color: Oklab): Srgb {
  const [r, g, b] = oklabToLinear(color);
  return { r: linearToGamma(r), g: linearToGamma(g), b: linearToGamma(b), a: color.alpha };
}

export function oklchToSrgb(L: number, C: number, hDegrees: number, alpha = 1): Srgb {
  const h = (hDegrees * Math.PI) / 180;
  return oklabToSrgb({ L, a: C * Math.cos(h), b: C * Math.sin(h), alpha });
}

function parseNumberOrPercent(token: string, percentBase = 1): number {
  const t = token.trim();
  if (t.endsWith("%")) return (parseFloat(t) / 100) * percentBase;
  return parseFloat(t);
}

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function hexToSrgb(hex: string): Srgb {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
}

const NAMED: Record<string, Srgb> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  white: { r: 1, g: 1, b: 1, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
};

/** Parses a resolved CSS color (`oklch()`, hex, named, `color-mix(in oklab, …)`); null when unsupported. */
export function parseColor(css: string): Srgb | null {
  const s = css.trim();
  if (HEX_PATTERN.test(s)) return hexToSrgb(s);
  if (s.toLowerCase() in NAMED) return NAMED[s.toLowerCase()];

  const oklch =
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?))?\s*\)$/i.exec(s);
  if (oklch) {
    const L = parseNumberOrPercent(oklch[1]);
    const C = parseNumberOrPercent(oklch[2], 0.4);
    const h = parseFloat(oklch[3]);
    const alpha = oklch[4] ? parseNumberOrPercent(oklch[4]) : 1;
    return oklchToSrgb(L, C, h, alpha);
  }

  const mix = /^color-mix\(\s*in\s+oklab\s*,(.+)\)$/i.exec(s);
  if (mix) {
    const args = splitTopLevel(mix[1], ",");
    if (args.length !== 2) return null;
    const parsePart = (part: string): { color: Srgb; pct: number | null } | null => {
      const tokens = splitTopLevel(part, " ").filter(Boolean);
      let pct: number | null = null;
      if (tokens.length > 1 && tokens[tokens.length - 1].endsWith("%")) {
        pct = parseFloat(tokens.pop()!) / 100;
      }
      const color = parseColor(tokens.join(" "));
      return color ? { color, pct } : null;
    };
    const p1 = parsePart(args[0]);
    const p2 = parsePart(args[1]);
    if (!p1 || !p2) return null;
    let w1 = p1.pct ?? (p2.pct === null ? 0.5 : 1 - p2.pct);
    let w2 = p2.pct ?? 1 - w1;
    const total = w1 + w2;
    w1 /= total;
    w2 /= total;
    // CSS interpolates premultiplied by alpha, so `transparent` only lowers
    // alpha instead of pulling the mix toward black.
    const a = srgbToOklab(p1.color);
    const b = srgbToOklab(p2.color);
    const alpha = a.alpha * w1 + b.alpha * w2;
    if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const pa = a.alpha * w1;
    const pb = b.alpha * w2;
    return oklabToSrgb({
      L: (a.L * pa + b.L * pb) / alpha,
      a: (a.a * pa + b.a * pb) / alpha,
      b: (a.b * pa + b.b * pb) / alpha,
      alpha,
    });
  }

  return null;
}

function round(x: number, places: number): number {
  const f = Math.pow(10, places);
  return Math.round(x * f) / f;
}

export function toHex({ r, g, b, a }: Srgb): string {
  const byte = (x: number) =>
    Math.round(clamp01(x) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${byte(r)}${byte(g)}${byte(b)}${a < 1 ? byte(a) : ""}`;
}

function toColorValue(css: string): ColorValue | null {
  const srgb = parseColor(css);
  if (!srgb) return null;
  return {
    hex: toHex(srgb),
    srgb: { r: round(srgb.r, 4), g: round(srgb.g, 4), b: round(srgb.b, 4), a: round(srgb.a, 4) },
    css,
  };
}

/** Code-point order: identical on every machine, unlike `localeCompare`. */
function sortedRecord<T>(entries: [string, T][]): Record<string, T> {
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

type Classified =
  | { kind: "absent" }
  | { kind: "color"; value: ColorValue }
  | { kind: "number"; value: number }
  | { kind: "raw"; value: string };

function classify(css: string | null): Classified {
  if (css === null) return { kind: "absent" };
  const color = toColorValue(css);
  if (color) return { kind: "color", value: color };
  if (/^-?[\d.]+(px|rem|em|%)?$/.test(css)) return { kind: "number", value: parseFloat(css) };
  return { kind: "raw", value: css };
}

function safeResolve(value: string, scope: Declarations): string {
  try {
    return resolveValue(value, scope);
  } catch {
    // Unresolvable references are exported verbatim under `raw`.
    return value;
  }
}

/** Builds the token document from the contents of src/styles.css. */
export function buildDesignTokens(
  css: string,
  source = "src/styles.css",
  /** Filled with the name of every alias left out (see `colorAliases` below). */
  skippedAliases: string[] = [],
): DesignTokens {
  const theme = extractBlock(css, "@theme inline");
  const root = extractBlock(css, ":root");
  const dark = extractBlock(css, ".dark");

  // CSS custom properties cascade: `.dark` overrides `:root`, and any
  // `var()` inside `.dark` resolves against the merged scope.
  const lightScope: Declarations = new Map([...theme, ...root]);
  const darkScope: Declarations = new Map([...theme, ...root, ...dark]);

  const fonts: [string, string[]][] = [];
  const radii: [string, number][] = [];
  const colorAliases: [string, string][] = [];
  const colors: [string, ThemedColor][] = [];
  const numbers: [string, ThemedNumber][] = [];
  const raw: [string, ThemedRaw][] = [];

  for (const [name, value] of theme) {
    if (name.startsWith("font-")) {
      fonts.push([
        name.slice("font-".length),
        splitTopLevel(value, ",").map((f) => f.replace(/^["']|["']$/g, "")),
      ]);
    } else if (name.startsWith("radius")) {
      const px = safeResolve(value, lightScope);
      const key = name === "radius" ? "default" : name.slice("radius-".length);
      const parsed = classify(px);
      if (parsed.kind === "number") radii.push([key, parsed.value]);
      else raw.push([`radius-${key}`, { light: px, dark: px }]);
    } else if (name.startsWith("color-")) {
      const key = name.slice("color-".length);
      const ref = /^var\(--([a-zA-Z0-9-]+)\)$/.exec(value.trim());
      if (ref) {
        colorAliases.push([key, ref[1]]);
      } else {
        // A literal inside @theme: same value in both modes.
        const resolved = safeResolve(value, lightScope);
        const parsed = classify(resolved);
        if (parsed.kind === "color")
          colors.push([key, { light: parsed.value, dark: parsed.value }]);
        else raw.push([key, { light: resolved, dark: resolved }]);
      }
    }
  }

  const names = new Set([...root.keys(), ...dark.keys()]);
  for (const name of names) {
    const lightCss = root.has(name) ? safeResolve(root.get(name)!, lightScope) : null;
    const darkCss = safeResolve(darkScope.get(name)!, darkScope);
    const light = classify(lightCss);
    const darkValue = classify(darkCss);
    const kinds = [light, darkValue].filter((c) => c.kind !== "absent").map((c) => c.kind);

    // A token is a color or a number only when every mode it is defined in
    // agrees; anything else is exported verbatim so `null` keeps meaning
    // "not defined in this mode", never "could not convert".
    if (kinds.every((k) => k === "color")) {
      colors.push([
        name,
        {
          light: light.kind === "color" ? light.value : null,
          dark: darkValue.kind === "color" ? darkValue.value : null,
        },
      ]);
    } else if (kinds.every((k) => k === "number")) {
      numbers.push([
        name,
        {
          light: light.kind === "number" ? light.value : null,
          dark: darkValue.kind === "number" ? darkValue.value : null,
        },
      ]);
    } else {
      raw.push([name, { light: lightCss, dark: darkCss }]);
    }
  }

  return {
    $comment:
      "Generated by scripts/export-design-tokens.ts from src/styles.css. Do not edit; run `bun run design-tokens`. Consumed by gradus-ios and gradus-android (Contract/design-tokens.json).",
    source,
    fonts: sortedRecord(fonts),
    radii: sortedRecord(radii),
    // An alias is only a token when its target is one: `--color-club-table-row` points at a
    // variable that exists only inside `.club-table`, so it has no value here and would leave
    // the app code generators referring to a colour that doesn't exist.
    colorAliases: sortedRecord(
      colorAliases.filter(([alias, target]) => {
        const defined = colors.some(([name]) => name === target);
        if (!defined) skippedAliases.push(alias);
        return defined;
      }),
    ),
    colors: sortedRecord(colors),
    numbers: sortedRecord(numbers),
    raw: sortedRecord(raw),
  };
}
