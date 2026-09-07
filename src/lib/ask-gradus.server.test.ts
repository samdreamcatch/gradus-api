import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { askGradus, askGradusInput, type AskFn } from "./ask-gradus.server";

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
        askGradus(askGradusInput.parse({ sport: "hockey", question: "how do I skate?" })),
      ),
    );
    expect(err?.code).toBe("ai_unavailable");
    expect(err?.status).toBe(503);
    expect(err?.message).toBe("AI service is unavailable. Please try again later.");
  });

  it("returns the injected ask function's text as the answer", async () => {
    const fakeAsk: AskFn = async () => ({ text: "Keep your knees bent." });
    const result = await withApiKey("test-key", () =>
      askGradus(askGradusInput.parse({ sport: "hockey", question: "how do I skate?" }), fakeAsk),
    );
    expect(result).toEqual({ answer: "Keep your knees bent." });
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
      askGradus(askGradusInput.parse({ sport: "hockey", question: "how do I skate?" }), fakeAsk),
    );
    expect(capturedSystem).toContain("speaking to a parent of a developing athlete");
  });
});
