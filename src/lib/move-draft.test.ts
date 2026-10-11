import { describe, expect, it } from "bun:test";
import {
  draftFills,
  isUnrecognised,
  marksAsAi,
  sameDraftTarget,
  unrecognisedMessage,
} from "./move-draft";

const draft = {
  description: "Start on a back outside edge.",
  cue: "Reach, pick, turn",
  why: "A reliable toe-pick take-off.",
  category: "Jumps",
};

describe("draftFills", () => {
  it("fills every empty field", () => {
    expect(draftFills({}, draft)).toEqual(draft);
  });

  it("never overwrites what the coach typed", () => {
    expect(
      draftFills({ description: "Mine", cue: "  ", why: "Also mine", category: "Spins" }, draft),
    ).toEqual({ cue: "Reach, pick, turn" });
  });

  it("treats a placeholder category as empty, and skips blank suggestions", () => {
    expect(
      draftFills({ category: "Uncategorized" }, { ...draft, cue: " " }, ["Uncategorized"]),
    ).toEqual({ description: draft.description, why: draft.why, category: "Jumps" });
    expect(
      draftFills({ category: "" }, { ...draft, category: undefined }).category,
    ).toBeUndefined();
  });
});

describe("unrecognised moves", () => {
  it("treats unsure and unknown as unrecognised, and a missing value as known", () => {
    expect(isUnrecognised({ recognition: "unsure" })).toBe(true);
    expect(isUnrecognised({ recognition: "unknown" })).toBe(true);
    expect(isUnrecognised({ recognition: "known" })).toBe(false);
    expect(isUnrecognised({})).toBe(false);
  });

  it("asks for a few words, naming the move and sport", () => {
    expect(unrecognisedMessage(" Zorbit ", "Figure Skating")).toBe(
      "Gradus doesn't recognise “Zorbit” in Figure Skating. Add a few words about it and draft again.",
    );
  });

  it("marks AI-written text but not the Gradus library's own", () => {
    expect(marksAsAi({ source: "ai" })).toBe(true);
    expect(marksAsAi({ source: "exercise_list" })).toBe(true);
    expect(marksAsAi({})).toBe(true);
    expect(marksAsAi({ source: "gradus_library" })).toBe(false);
  });
});

describe("sameDraftTarget", () => {
  const asked = { name: "Toe loop", sport: "figure_skating" };

  it("keeps a draft while the name and sport are unchanged, ignoring outer spaces", () => {
    expect(sameDraftTarget(asked, { name: " Toe loop ", sport: "figure_skating" })).toBe(true);
  });

  it("drops a draft once the coach renamed the move or changed its sport", () => {
    expect(sameDraftTarget(asked, { name: "Toe loops", sport: "figure_skating" })).toBe(false);
    expect(sameDraftTarget(asked, { name: "Toe loop", sport: "dance" })).toBe(false);
    expect(sameDraftTarget(asked, { name: "", sport: "figure_skating" })).toBe(false);
    expect(sameDraftTarget(asked, {})).toBe(false);
  });
});
