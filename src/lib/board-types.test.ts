import { describe, expect, it } from "bun:test";
import vectors from "../../docs/api/vectors/name-normalization.json";
import { normalizeName } from "./board-types";

describe("normalizeName", () => {
  it("matches every shared vector (docs/api/vectors/name-normalization.json)", () => {
    expect(vectors.cases.length).toBeGreaterThan(10);
    for (const { input, expected } of vectors.cases) {
      expect(normalizeName(input)).toBe(expected);
    }
  });

  it("is idempotent", () => {
    for (const { expected } of vectors.cases) {
      expect(normalizeName(expected)).toBe(expected);
    }
  });
});
