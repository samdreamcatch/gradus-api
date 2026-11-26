import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { MESSAGE_RULE_SET, checkMessage, matchMessage, normalizeVariants } from "./message-rules";
import { MESSAGE_RULE_CASES } from "./message-rules.cases";

describe("message rules (PRD #64)", () => {
  for (const [text, expected] of MESSAGE_RULE_CASES) {
    it(`${expected ?? "passes"}: ${text}`, () => {
      expect(checkMessage(text)?.category ?? null).toBe(expected);
    });
  }

  it("normalizes case, accents, apostrophes and punctuation", () => {
    expect(normalizeVariants("You’RE  só… WORTHLESS!")[0]).toBe("youre so worthless qzq");
  });

  it("reports one match per category", () => {
    const cats = matchMessage("I hate you and I want to die").map((m) => m.category);
    expect(cats).toEqual(["abuse", "self_harm"]);
  });

  it("uses only portable pattern syntax and unique ids", () => {
    const ids = new Set<string>();
    for (const entry of [...MESSAGE_RULE_SET.rules, ...MESSAGE_RULE_SET.never]) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
      expect(entry.pattern).not.toMatch(/\\|[A-Z](?![A-Z]*\})|\^|\$|\./);
    }
  });

  it("matches the shared vector (docs/api/vectors/message-rules.json)", () => {
    const vector = JSON.parse(readFileSync("docs/api/vectors/message-rules.json", "utf8"));
    expect(vector.cases[0].expected).toEqual(JSON.parse(JSON.stringify(MESSAGE_RULE_SET)));
    for (const c of vector.cases.slice(1)) {
      const m = checkMessage(c.input.text);
      expect(m ? { category: m.category, ruleId: m.ruleId } : null).toEqual(c.expected);
    }
    expect(vector.cases.length - 1).toBe(MESSAGE_RULE_CASES.length);
  });
});
