import { describe, expect, it } from "bun:test";
import {
  extractJsonObject,
  salvageSlots,
  SLOT_ATTEMPTS,
  slotWithRetries,
  VOICE_MODELS,
  VoiceAiError,
  type ParseContext,
  type SlotAttempt,
  type Slots,
} from "./voice.server";

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
      athleteName: "Tobias",
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

describe("slotWithRetries", () => {
  const ctx: ParseContext = {
    mode: "create",
    transcript: "Plan for Tobias, single axel five times",
    athletes: [],
    library: [],
  };
  const slots: Slots = {
    title: null,
    titleQuote: null,
    athleteName: null,
    athleteQuote: null,
    moves: [],
    leftover: null,
  };
  const noLog = () => {};

  it("returns the first attempt's slots without pausing", async () => {
    const pauses: number[] = [];
    const seen: SlotAttempt[] = [];
    const result = await slotWithRetries(ctx, {
      attempt: async (_c, a) => {
        seen.push(a);
        return slots;
      },
      sleep: async (ms) => {
        pauses.push(ms);
      },
      log: noLog,
    });
    expect(result?.index).toBe(0);
    expect(pauses).toEqual([]);
    expect(seen.map((a) => a.variant)).toEqual(["full"]);
  });

  it("pauses, then asks for the simple shape, then a second model", async () => {
    const pauses: number[] = [];
    const seen: SlotAttempt[] = [];
    const result = await slotWithRetries(ctx, {
      attempt: async (_c, a) => {
        seen.push(a);
        if (seen.length < 3) throw new Error("schema mismatch");
        return slots;
      },
      sleep: async (ms) => {
        pauses.push(ms);
      },
      log: noLog,
    });
    expect(result?.index).toBe(2);
    expect(pauses).toEqual([750, 750]);
    expect(seen.map((a) => [a.variant, a.model])).toEqual([
      ["full", VOICE_MODELS.primary],
      ["simple", VOICE_MODELS.primary],
      ["simple", VOICE_MODELS.fallback],
    ]);
    expect(SLOT_ATTEMPTS.length).toBe(3);
  });

  it("returns null when every attempt fails", async () => {
    let calls = 0;
    const result = await slotWithRetries(ctx, {
      attempt: async () => {
        calls += 1;
        throw new Error("nope");
      },
      sleep: async () => {},
      log: noLog,
    });
    expect(result).toBeNull();
    expect(calls).toBe(3);
  });

  it("stops at once on rate limits and exhausted credits", async () => {
    let calls = 0;
    const busy = slotWithRetries(ctx, {
      attempt: async () => {
        calls += 1;
        throw Object.assign(new Error("429"), { statusCode: 429 });
      },
      sleep: async () => {},
      log: noLog,
    });
    const error = await busy.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(VoiceAiError);
    expect((error as Error).message).toContain("AI is busy");
    expect(calls).toBe(1);
    const broke = slotWithRetries(ctx, {
      attempt: async () => {
        throw Object.assign(new Error("402"), { statusCode: 402 });
      },
      sleep: async () => {},
      log: noLog,
    });
    await expect(broke).rejects.toThrow("credits");
  });

  it("still stops on a rate limit after an earlier schema failure", async () => {
    const seen: SlotAttempt[] = [];
    const busy = slotWithRetries(ctx, {
      attempt: async (_c, a) => {
        seen.push(a);
        if (seen.length === 1) throw new Error("schema mismatch");
        throw Object.assign(new Error("429"), { statusCode: 429 });
      },
      sleep: async () => {},
      log: noLog,
    });
    await expect(busy).rejects.toThrow("AI is busy");
    expect(seen.map((a) => a.variant)).toEqual(["full", "simple"]);
  });

  it("stops at once when the attempt itself says the AI is not configured", async () => {
    let calls = 0;
    const pauses: number[] = [];
    const missingKey = slotWithRetries(ctx, {
      attempt: async () => {
        calls += 1;
        throw new VoiceAiError("AI not configured");
      },
      sleep: async (ms) => {
        pauses.push(ms);
      },
      log: noLog,
    });
    await expect(missingKey).rejects.toThrow("AI not configured");
    expect(calls).toBe(1);
    expect(pauses).toEqual([]);
  });

  it("logs a recovery at info level and failures at error level", async () => {
    const levels: string[] = [];
    let calls = 0;
    await slotWithRetries(ctx, {
      attempt: async () => {
        calls += 1;
        if (calls === 1) throw new Error("schema mismatch");
        return slots;
      },
      sleep: async () => {},
      log: (level, event) => {
        levels.push(`${level}:${event}`);
      },
    });
    expect(levels).toEqual(["error:slot failed", "info:slot recovered"]);
  });
});
