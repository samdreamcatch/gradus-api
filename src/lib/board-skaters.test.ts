import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { eventKey } from "./board-skaters";

type Vector = {
  cases: { input: { name: string; segment: string; rink: string }; expected: string }[];
};

describe("eventKey", () => {
  it("matches every shared vector (docs/api/vectors/event-key.json)", () => {
    const vectors = JSON.parse(readFileSync("docs/api/vectors/event-key.json", "utf8")) as Vector;
    expect(vectors.cases.length).toBeGreaterThan(0);
    for (const c of vectors.cases) {
      expect(eventKey(c.input.name, c.input.segment, c.input.rink)).toBe(c.expected);
    }
  });
});
