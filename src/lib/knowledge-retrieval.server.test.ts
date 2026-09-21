import { describe, expect, it } from "bun:test";
import {
  describeHit,
  formatKnowledgeForPrompt,
  type KnowledgeHit,
} from "./knowledge-retrieval.server";

const hit = (over: Partial<KnowledgeHit>): KnowledgeHit => ({
  chunkId: "c",
  sourceId: "s",
  title: "Power and Control Wheel",
  publisher: "The Athlete Survivors' Assist",
  edition: "",
  section: "Isolation",
  page: 2,
  content: "Coaches who isolate athletes from parents…",
  quoteAllowed: true,
  resourceId: "r1",
  externalUrl: null,
  similarity: 0.8,
  ...over,
});

describe("formatKnowledgeForPrompt", () => {
  it("numbers passages, wraps quotable text as untrusted content, and returns citations", () => {
    const { block, citations } = formatKnowledgeForPrompt([
      hit({}),
      hit({ chunkId: "d", section: "Threats", page: 3 }),
    ]);
    expect(block).toContain("[1] Power and Control Wheel — Isolation, p. 2");
    expect(block).toContain("[2] Power and Control Wheel — Threats, p. 3");
    expect(block).toContain('<untrusted_user_content> label="source_1"');
    expect(citations.map((c) => c.index)).toEqual([1, 2]);
    expect(citations[0]!.resourceId).toBe("r1");
  });

  it("never reproduces text from a cite-only source", () => {
    const { block } = formatKnowledgeForPrompt([
      hit({
        quoteAllowed: false,
        content: "",
        title: "USFS Rulebook",
        edition: "2026-27",
        section: "3.10",
        page: 44,
      }),
    ]);
    expect(block).toContain("[1] USFS Rulebook (2026-27) — 3.10, p. 44");
    expect(block).toContain("may be cited but not quoted");
    expect(block).not.toContain("untrusted_user_content");
  });

  it("caps a long passage", () => {
    const { block } = formatKnowledgeForPrompt([hit({ content: "x".repeat(5000) })], {
      maxCharsPerPassage: 100,
    });
    expect(block.length).toBeLessThan(400);
    expect(block).toContain("…");
  });

  it("describes a hit without section or page", () => {
    expect(describeHit(hit({ section: "", page: null }))).toBe("Power and Control Wheel");
  });
});
