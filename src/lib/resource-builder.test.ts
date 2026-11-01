import { describe, expect, it } from "bun:test";
import { pdfSafe, wrapLines } from "./resource-builder";

describe("pdfSafe", () => {
  it("swaps curly quotes, dashes and accents for plain text", () => {
    expect(pdfSafe("“Café” — it’s")).toBe('"Cafe" - it\'s');
  });
  it("drops characters the PDF fonts can't draw", () => {
    expect(pdfSafe("Go 🏒 team")).toBe("Go  team");
  });
});

describe("wrapLines", () => {
  const measure = (s: string) => s.length;
  it("wraps at the width without splitting words", () => {
    expect(wrapLines("one two three four", 9, measure)).toEqual(["one two", "three", "four"]);
  });
  it("keeps blank lines between paragraphs", () => {
    expect(wrapLines("a\n\nb", 10, measure)).toEqual(["a", "", "b"]);
  });
  it("keeps a single over-long word on its own line", () => {
    expect(wrapLines("supercalifragilistic", 5, measure)).toEqual(["supercalifragilistic"]);
  });
});
