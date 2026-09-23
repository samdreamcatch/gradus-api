import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  NOT_FROM_SOURCES,
  SAFETY_NOT_COVERED,
  askGradus,
  askGradusInput,
  citedIndices,
  isSafetyQuestion,
  webAnswerText,
  type AskFn,
} from "./ask-gradus.server";
import type { KnowledgeHit } from "./knowledge-retrieval.server";

/** No corpus: every call below answers ungrounded unless a test passes hits. */
const noHits = { retrieve: async () => [] as KnowledgeHit[] };

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

/** Runs `run` with `LOVABLE_API_KEY` temporarily set (or unset), then restores it. */
async function withApiKey<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const original = process.env.LOVABLE_API_KEY;
  if (value === undefined) delete process.env.LOVABLE_API_KEY;
  else process.env.LOVABLE_API_KEY = value;
  try {
    return await run();
  } finally {
    if (original === undefined) delete process.env.LOVABLE_API_KEY;
    else process.env.LOVABLE_API_KEY = original;
  }
}

describe("askGradusInput", () => {
  it("defaults audience to parent", () => {
    const parsed = askGradusInput.parse({ sport: "hockey", question: "how do I skate?" });
    expect(parsed.audience).toBe("parent");
  });

  it("accepts an explicit athlete audience", () => {
    const parsed = askGradusInput.parse({
      sport: "hockey",
      question: "how do I skate?",
      audience: "athlete",
    });
    expect(parsed.audience).toBe("athlete");
  });

  it("rejects a too-short question", () => {
    expect(askGradusInput.safeParse({ sport: "hockey", question: "?" }).success).toBe(false);
  });
});

describe("askGradus", () => {
  it("throws ai_unavailable 503 'AI service is unavailable. Please try again later.' when LOVABLE_API_KEY is not set", async () => {
    const err = await withApiKey(undefined, () =>
      caught(() =>
        askGradus(
          askGradusInput.parse({ sport: "hockey", question: "how do I skate?" }),
          undefined,
          noHits,
        ),
      ),
    );
    expect(err?.code).toBe("ai_unavailable");
    expect(err?.status).toBe(503);
    expect(err?.message).toBe("AI service is unavailable. Please try again later.");
  });

  it("maps a thrown gateway/model error to ai_unavailable 503, not a raw exception", async () => {
    const failingAsk: AskFn = async () => {
      throw new Error("gateway timed out");
    };
    const err = await withApiKey("test-key", () =>
      caught(() =>
        askGradus(
          askGradusInput.parse({ sport: "hockey", question: "how do I skate?" }),
          failingAsk,
          noHits,
        ),
      ),
    );
    expect(err?.code).toBe("ai_unavailable");
    expect(err?.status).toBe(503);
    expect(err?.message).toBe("AI service is unavailable. Please try again later.");
  });

  it("returns the injected ask function's text as the answer", async () => {
    const fakeAsk: AskFn = async () => ({ text: "Keep your knees bent." });
    const result = await withApiKey("test-key", () =>
      askGradus(
        askGradusInput.parse({ sport: "hockey", question: "how do I skate?" }),
        fakeAsk,
        noHits,
      ),
    );
    // Nothing in the corpus: a general answer that says so first (decision #16).
    expect(result).toEqual({
      answer: `${NOT_FROM_SOURCES}\n\nKeep your knees bent.`,
      grounded: false,
      safety: false,
      sources: [],
    });
  });

  it("instructs the model to address an athlete directly and never as a parent's child", async () => {
    let capturedSystem = "";
    const fakeAsk: AskFn = async (args) => {
      capturedSystem = args.system;
      return { text: "ok" };
    };
    await withApiKey("test-key", () =>
      askGradus(
        askGradusInput.parse({ sport: "hockey", question: "how do I skate?", audience: "athlete" }),
        fakeAsk,
        noHits,
      ),
    );
    expect(capturedSystem).toContain("speaking directly to a young athlete");
    expect(capturedSystem).toContain('Never address a parent or refer to "your child."');
  });

  it("uses the parent-facing system prompt by default", async () => {
    let capturedSystem = "";
    const fakeAsk: AskFn = async (args) => {
      capturedSystem = args.system;
      return { text: "ok" };
    };
    await withApiKey("test-key", () =>
      askGradus(
        askGradusInput.parse({ sport: "hockey", question: "how do I skate?" }),
        fakeAsk,
        noHits,
      ),
    );
    expect(capturedSystem).toContain("speaking to a parent of a developing athlete");
  });
});

/* ------------------------------------------------------ grounded (L5) */

const hit = (over: Partial<KnowledgeHit>): KnowledgeHit => ({
  chunkId: "c1",
  sourceId: "s1",
  title: "Rules of Golf",
  publisher: "USGA",
  edition: "2023",
  section: "Rule 13.1",
  page: 91,
  content: "A player may repair damage on the putting green.",
  quoteAllowed: true,
  resourceId: "r1",
  externalUrl: null,
  similarity: 0.62,
  ...over,
});

const golf = (question: string) =>
  askGradusInput.parse({ sport: "golf", question, audience: "parent" });

describe("grounded answers", () => {
  it("answers from the passages and returns only the sources it cites", async () => {
    const prompts: string[] = [];
    const ask: AskFn = async ({ prompt }) => {
      prompts.push(prompt);
      return { text: "You can repair a pitch mark on the green [2]." };
    };
    const result = await withApiKey("k", () =>
      askGradus(golf("Can my kid fix a ball mark on the green?"), ask, {
        retrieve: async () => [
          hit({ chunkId: "a", title: "Etiquette", similarity: 0.4 }),
          hit({ chunkId: "b" }),
        ],
      }),
    );
    expect(result.grounded).toBe(true);
    expect(result.safety).toBe(false);
    expect(result.sources).toEqual([
      {
        index: 2,
        title: "Rules of Golf",
        publisher: "USGA",
        edition: "2023",
        section: "Rule 13.1",
        page: 91,
        resourceId: "r1",
        externalUrl: null,
      },
    ]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("PASSAGES:");
    expect(prompts[0]).toContain("[2] Rules of Golf (2023) — Rule 13.1, p. 91");
  });

  it("falls back to general knowledge, saying so first, when the passages don't cover it", async () => {
    const systems: string[] = [];
    const ask: AskFn = async ({ system }) => {
      systems.push(system);
      return { text: systems.length === 1 ? "NOT_COVERED" : "Try a lighter grip." };
    };
    const result = await withApiKey("k", () =>
      askGradus(golf("How tight should the grip be?"), ask, { retrieve: async () => [hit({})] }),
    );
    expect(result).toEqual({
      answer: `${NOT_FROM_SOURCES}\n\nTry a lighter grip.`,
      grounded: false,
      safety: false,
      sources: [],
    });
    // The second call has the persona and no grounding rules.
    expect(systems[1]).not.toContain("NOT_COVERED");
  });

  it("treats NOT_COVERED anywhere in the reply as not covered, even with a citation", async () => {
    let calls = 0;
    const ask: AskFn = async () => ({
      text: ++calls === 1 ? "Here is something [1]. NOT_COVERED" : "General.",
    });
    const result = await withApiKey("k", () =>
      askGradus(golf("What should we pack?"), ask, { retrieve: async () => [hit({})] }),
    );
    expect(result.grounded).toBe(false);
    expect(result.answer.startsWith(NOT_FROM_SOURCES)).toBe(true);
  });

  it("treats an answer that cites nothing as not covered, and drops weak passages", async () => {
    let calls = 0;
    const ask: AskFn = async () => ({ text: ++calls === 1 ? "Just relax." : "General." });
    const uncited = await withApiKey("k", () =>
      askGradus(golf("How do I relax on the tee?"), ask, { retrieve: async () => [hit({})] }),
    );
    expect(uncited.grounded).toBe(false);

    let prompts = 0;
    const count: AskFn = async () => (prompts++, { text: "General." });
    await withApiKey("k", () =>
      askGradus(golf("What should we pack?"), count, {
        retrieve: async () => [hit({ similarity: 0.1 })],
      }),
    );
    // Only the general call: the 0.1 passage never reached a grounded prompt.
    expect(prompts).toBe(1);
  });

  it("never falls back on a safety topic: the panel and a fixed line instead", async () => {
    let calls = 0;
    const ask: AskFn = async () => (calls++, { text: "NOT_COVERED" });
    const result = await withApiKey("k", () =>
      askGradus(golf("My daughter says her wrist hurts but she wants to keep playing"), ask, {
        retrieve: async () => [hit({})],
      }),
    );
    expect(result).toEqual({
      answer: SAFETY_NOT_COVERED,
      grounded: false,
      safety: true,
      sources: [],
    });
    expect(calls).toBe(1);
  });

  it("keeps a grounded safety answer and its sources, flagged for the panel", async () => {
    const ask: AskFn = async () => ({ text: "No adult should ask a child to keep secrets [1]." });
    const result = await withApiKey("k", () =>
      askGradus(golf("The coach told my son to keep it a secret"), ask, {
        retrieve: async () => [
          hit({ title: "Appropriate Athlete–Coach Relationships", publisher: "The Assist" }),
        ],
      }),
    );
    expect(result.safety).toBe(true);
    expect(result.grounded).toBe(true);
    expect(result.sources.map((s) => s.index)).toEqual([1]);
  });

  it("answers ungrounded, not with an error, when retrieval fails", async () => {
    const ask: AskFn = async () => ({ text: "Swing smoothly." });
    const result = await withApiKey("k", () =>
      askGradus(golf("How do I swing?"), ask, {
        retrieve: async () => {
          throw new Error("embeddings down");
        },
      }),
    );
    expect(result.grounded).toBe(false);
    expect(result.answer.startsWith(NOT_FROM_SOURCES)).toBe(true);
  });
});

describe("safety classification", () => {
  it("catches abuse, self-harm, eating, and pain questions", () => {
    for (const q of [
      "Is it normal for a coach to text my daughter at night and ask her to keep it secret?",
      "My son said he wants to die after practice",
      "She's been skipping meals before competitions",
      "He keeps skating through the pain in his knee",
      "What do I do after a concussion?",
      "Someone touched me in the locker room",
      "Her coach asked her to keep secrets from us",
      "The coach texts my daughter late at night",
      "The coach hits the kids when they fall",
      "Is it normal to have weekly weigh-ins at 11?",
      "She's been vomiting after meals",
      "He said he doesn't want to be alive anymore",
      "My son is always alone with the coach after practice",
    ]) {
      expect(isSafetyQuestion(q)).toBe(true);
    }
  });

  it("leaves ordinary coaching questions alone", () => {
    for (const q of [
      "How many times a week should she practice her axel?",
      "What's a good warm-up before a tennis match?",
      "How do I read a putt?",
      "What's the secret to a good spin?",
    ]) {
      expect(isSafetyQuestion(q)).toBe(false);
    }
  });
});

describe("the web's answer text", () => {
  it("drops [n] markers and puts the hotlines above a safety answer", () => {
    expect(citedIndices("A [1]. B [3][1].")).toEqual([1, 3]);
    const plain = webAnswerText(
      { answer: "Repair it [1].", grounded: true, safety: false, sources: [] },
      "PANEL",
    );
    expect(plain).toBe("Repair it.");
    const safety = webAnswerText(
      { answer: SAFETY_NOT_COVERED, grounded: false, safety: true, sources: [] },
      "PANEL",
    );
    expect(safety).toBe(`PANEL\n\n${SAFETY_NOT_COVERED}`);
  });
});
