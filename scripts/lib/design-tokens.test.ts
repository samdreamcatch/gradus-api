import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildDesignTokens, oklchToSrgb, parseColor, resolveValue, toHex } from "./design-tokens";

const css = readFileSync(resolve(__dirname, "../../src/styles.css"), "utf8");

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function expectClose(hex: string, expected: string, tolerance = 2) {
  const a = channels(hex);
  const b = channels(expected);
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(tolerance);
  }
}

describe("oklch → sRGB", () => {
  it("matches the CSS Color 4 reference example", () => {
    // Spec example: oklch(40.101% 0.12332 21.555) ≈ rgb(49.06% 13.87% 15.9%).
    const c = oklchToSrgb(0.40101, 0.12332, 21.555);
    expect(c.r).toBeCloseTo(0.4906, 2);
    expect(c.g).toBeCloseTo(0.1387, 2);
    expect(c.b).toBeCloseTo(0.159, 2);
  });

  it("lands near the hex values annotated in styles.css", () => {
    // The comments in styles.css are hand-written approximations, so allow
    // a few units per channel; the spec example above pins the math.
    expectClose(toHex(oklchToSrgb(0.972, 0.005, 250)), "#F5F6FA", 4); // --background
    expectClose(toHex(oklchToSrgb(0.92, 0.005, 260)), "#E6E7EB", 4); // --divider
  });

  it("white and black round-trip", () => {
    expect(toHex(oklchToSrgb(1, 0, 0))).toBe("#FFFFFF");
    expect(toHex(oklchToSrgb(0, 0, 0))).toBe("#000000");
  });

  it("alpha is carried through", () => {
    const c = parseColor("oklch(1 0 0 / 0.55)");
    expect(c?.a).toBeCloseTo(0.55);
    expect(toHex(c!)).toBe("#FFFFFF8C");
  });

  it("hex and named colors parse; malformed hex is rejected", () => {
    expect(toHex(parseColor("#ecf1dd")!)).toBe("#ECF1DD");
    expect(toHex(parseColor("#abc")!)).toBe("#AABBCC");
    expect(parseColor("transparent")?.a).toBe(0);
    expect(parseColor("#ecf1d")).toBeNull();
    expect(parseColor("#ecf1ddf")).toBeNull();
    expect(parseColor("rgb(1 2 3)")).toBeNull();
  });

  it("color-mix in oklab lands between its inputs", () => {
    const mixed = parseColor("color-mix(in oklab, #000000 50%, #ffffff)")!;
    expect(mixed.r).toBeGreaterThan(0.3);
    expect(mixed.r).toBeLessThan(0.7);
  });

  it("color-mix with transparent keeps the hue and only lowers alpha (premultiplied)", () => {
    const accent = parseColor("oklch(0.847 0.19 119)")!;
    const mixed = parseColor("color-mix(in oklab, oklch(0.847 0.19 119) 28%, transparent)")!;
    expect(mixed.a).toBeCloseTo(0.28);
    expect(mixed.r).toBeCloseTo(accent.r, 2);
    expect(mixed.g).toBeCloseTo(accent.g, 2);
    expect(mixed.b).toBeCloseTo(accent.b, 2);
    expect(parseColor("color-mix(in oklab, transparent, transparent)")).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
  });

  it("renders out-of-gamut tokens exactly as Chrome does (per-channel clipping)", () => {
    // Reference bytes read back from a Chrome sRGB canvas filled with each
    // color (2026-09-05). CSS Color 4 describes chroma-reduction gamut
    // mapping, but browsers clip; matching them is the point of this file.
    const chrome: [number, number, number, string][] = [
      [0.87, 0.17, 55, "#FFB35B"], // dark --pen-orange, linear red 1.41
      [0.86, 0.16, 8, "#FFA1BD"], // dark --pen-pink
      [0.82, 0.15, 25, "#FF9B92"], // dark --destructive-ink
      [0.86, 0.175, 310, "#F4AEFF"], // dark --pen-iris
      [0.339, 0.095, 119, "#333E00"], // light --pen-tennis-ink
      [0.965, 0.028, 235, "#E2F7FF"], // light --pen-pool-wash
      [0.847, 0.19, 119, "#C0DD27"], // light --pen-tennis
      [0.5, 0.1, 20, "#944A4B"],
    ];
    for (const [L, C, h, hex] of chrome) expectClose(toHex(oklchToSrgb(L, C, h)), hex, 1);
  });
});

describe("var() resolution", () => {
  it("follows chains and fallbacks", () => {
    const scope = new Map([
      ["a", "var(--b)"],
      ["b", "#ffffff"],
    ]);
    expect(resolveValue("var(--a)", scope)).toBe("#ffffff");
    expect(resolveValue("var(--missing, var(--b))", scope)).toBe("#ffffff");
  });

  it("throws on cycles and unresolved references", () => {
    const scope = new Map([["a", "var(--a)"]]);
    expect(() => resolveValue("var(--a)", scope)).toThrow(/cycle/);
    expect(() => resolveValue("var(--nope)", scope)).toThrow(/unresolved/);
  });
});

describe("buildDesignTokens on the real stylesheet", () => {
  const tokens = buildDesignTokens(css);

  it("exports the documented surfaces in both modes", () => {
    expectClose(tokens.colors.background.light!.hex, "#F5F6FA", 4);
    expect(tokens.colors.background.dark!.hex).not.toBe(tokens.colors.background.light!.hex);
    expect(tokens.colors.card.light!.srgb.a).toBeCloseTo(0.55);
    expect(tokens.colors.card.dark!.srgb.a).toBeCloseTo(0.62);
  });

  it("accent changes hue between modes exactly as the CSS does", () => {
    expect(tokens.colors.accent.light).toEqual(tokens.colors["pen-tennis"].light);
    expect(tokens.colors.accent.dark).toEqual(tokens.colors["pen-pool"].dark);
  });

  it("resolves the color-mix sidebar token", () => {
    expect(tokens.colors["sidebar-accent"].light).not.toBeNull();
    expect(tokens.colors["sidebar-accent"].dark).not.toBeNull();
  });

  it("keeps null for 'absent in this mode' and never for 'could not convert'", () => {
    const tokens = buildDesignTokens(
      "@theme inline {\n  --radius-sm: 8px;\n}\n:root {\n  --foo: oklch(0.5 0.1 20);\n  --shadow: 0 1px 2px\n    oklch(0 0 0 / 0.1);\n}\n.dark {\n  --foo: rgb(1 2 3);\n  --only: 0.5;\n}\n",
    );
    expect(tokens.colors.foo).toBeUndefined();
    expect(tokens.raw.foo).toEqual({ light: "oklch(0.5 0.1 20)", dark: "rgb(1 2 3)" });
    expect(tokens.raw.shadow).toEqual({
      light: "0 1px 2px oklch(0 0 0 / 0.1)",
      dark: "0 1px 2px oklch(0 0 0 / 0.1)",
    });
    expect(tokens.numbers.only).toEqual({ light: null, dark: 0.5 });
  });

  it("survives comments containing braces and multi-line values", () => {
    const tokens = buildDesignTokens(
      "@theme inline {\n}\n:root {\n  /* note:\n}\n  still a comment */\n  --a: oklch(0.5 0 0);\n  --b: oklch(\n    0.6 0 0\n  );\n}\n.dark {\n}\n",
    );
    expect(Object.keys(tokens.colors).sort()).toEqual(["a", "b"]);
    expect(tokens.colors.b.light!.css).toBe("oklch( 0.6 0 0 )");
  });

  it("dark-only tokens have a null light value", () => {
    expect(tokens.colors["ink-navy"].light).toBeNull();
    expect(tokens.colors["ink-navy"].dark).not.toBeNull();
    expect(tokens.numbers["logo-stripe-opacity"]).toEqual({ light: null, dark: 0.7 });
  });

  it("carries fonts, radii, and aliases", () => {
    expect(tokens.fonts.display[0]).toBe("EB Garamond");
    expect(tokens.fonts.mono[0]).toBe("JetBrains Mono");
    expect(tokens.radii).toMatchObject({
      sm: 8,
      md: 14,
      lg: 20,
      xl: 28,
      "2xl": 36,
      "3xl": 44,
      default: 14,
    });
    expect(tokens.colorAliases.primary).toBe("accent");
    expect(tokens.colorAliases.destructive).toBe("destructive-ink");
  });

  it("every :root and .dark token is accounted for", () => {
    const count = (selector: string) =>
      (
        css
          .match(new RegExp(`^${selector.replace(".", "\\.")} \\{[\\s\\S]*?^\\}`, "m"))![0]
          .match(/^\s*--/gm) ?? []
      ).length;
    const declared = new Set<string>();
    for (const sel of [":root", ".dark"]) {
      const block = css.match(new RegExp(`^${sel.replace(".", "\\.")} \\{[\\s\\S]*?^\\}`, "m"))![0];
      for (const m of block.matchAll(/^\s*--([a-zA-Z0-9-]+):/gm)) declared.add(m[1]);
    }
    expect(count(":root")).toBeGreaterThan(40);
    const exported = new Set([
      ...Object.keys(tokens.colors),
      ...Object.keys(tokens.numbers),
      ...Object.keys(tokens.raw),
    ]);
    for (const name of declared) expect(exported.has(name)).toBe(true);
    // Nothing in the real stylesheet should need the raw escape hatch today.
    expect(Object.keys(tokens.raw)).toEqual([]);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(buildDesignTokens(css))).toBe(JSON.stringify(tokens));
  });
});
