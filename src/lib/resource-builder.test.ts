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

import { brandFooter, brandHeader, hexToUnit } from "./resource-builder";
describe("branding", () => {
  it("converts brand hex colors", () => {
    expect(hexToUnit("#FF0000")).toEqual([1, 0, 0]);
    expect(hexToUnit("nope", "#0000FF")).toEqual([0, 0, 1]);
  });
  it("uses custom header/footer text, else the club name", () => {
    expect(brandHeader({ headerText: "" }, "Test Club")).toBe("Test Club");
    expect(brandHeader({ headerText: "TC Skating" }, "Test Club")).toBe("TC Skating");
    expect(brandFooter({ footerText: "testclub.org" }, "Test Club", 2, 3)).toBe("testclub.org - 2 of 3");
  });
});
