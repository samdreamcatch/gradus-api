import { describe, expect, it } from "bun:test";
import { extractJsonObject, salvageSlots } from "./voice.server";

describe("extractJsonObject", () => {
  it("pulls the object out of a code-fenced answer", () => {
    const raw = 'Sure!\n```json\n{"title":"Week one","moves":[]}\n```\nHope that helps.';
    expect(extractJsonObject(raw)).toEqual({ title: "Week one", moves: [] });
  });

  it("handles braces inside strings", () => {
    expect(extractJsonObject('{"leftover":"he said {maybe} later"}')).toEqual({
      leftover: "he said {maybe} later",
    });
  });

  it("returns null when there is no object", () => {
    expect(extractJsonObject("no json here")).toBeNull();
    expect(extractJsonObject("")).toBeNull();
  });
});

describe("salvageSlots", () => {
  it("keeps good moves and drops only the malformed one", () => {
    const slots = salvageSlots({
      title: "Jump consistency",
      athleteName: "Leon",
      moves: [
        { name: "Single axel", targetKind: "reps", targetValue: 10 },
        { description: "no name at all" },
        { name: "Camel spin", targetKind: "mins", targetValue: "2 minutes" },
      ],
    });
    expect(slots?.moves.map((m) => m.name)).toEqual(["Single axel", "Camel spin"]);
    expect(slots?.moves[1]?.targetValue).toBe(2);
    expect(slots?.title).toBe("Jump consistency");
  });

  it("normalizes an unexpected target kind to null instead of failing", () => {
    const slots = salvageSlots({ moves: [{ name: "Edge pulls", targetKind: "laps" }] });
    expect(slots?.moves[0]?.targetKind).toBeNull();
  });

  it("keeps a title-only dictation with no moves", () => {
    const slots = salvageSlots({ title: "Taper week", moves: [] });
    expect(slots?.title).toBe("Taper week");
    expect(slots?.moves).toEqual([]);
  });

  it("returns null for an empty or non-object answer", () => {
    expect(salvageSlots(null)).toBeNull();
    expect(salvageSlots("nope")).toBeNull();
    expect(salvageSlots({ title: null, moves: [] })).toBeNull();
  });
});
