import { describe, expect, it } from "bun:test";
import {
  extractJsonObject,
  salvageSlots,
  SLOT_ATTEMPTS,
  slotWithRetries,
  buildDraft,
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

describe("buildDraft — no roster names reach the model (App Review 5.1.2(i))", () => {
  it("keeps Make and Take as instructions without introducing another athlete", async () => {
    const draft = await buildDraft({
      mode: "create", transcript: "Mike needs spins. Make sure he keeps his arms in. Take time on entries.",
      athletes: [{ id: "mike", name: "Mike Reed" }, { id: "jake", name: "Jake Brook" }], library: [],
    }, {
      attempt: async (ctx) => {
        expect(ctx.transcript).toBe("[ATHLETE] needs spins. Make sure he keeps his arms in. Take time on entries.");
        expect(ctx.transcript).not.toContain("[ATHLETE 2]");
        return { title: null, athleteName: "[ATHLETE]", athleteQuote: "[ATHLETE]", moves: [], leftover: "Make sure he keeps his arms in. Take time on entries." } as unknown as Slots;
      },
      cleanup: async () => "Make sure he keeps his arms in. Take time on entries.",
    });
    expect(draft.athleteId).toBe("mike");
    expect(draft.notes).toBe("Make sure he keeps his arms in. Take time on entries.");
  });

  it("masks roster names in the transcript and plan, matches the athlete here, and restores names", async () => {
    let seenByModel = "";
    let notesPrompt = "";
    const draft = await buildDraft(
      {
        mode: "edit",
        transcript: "For Tobias Fairbank: Tobias needs double toes. Linnea is out.",
        athletes: [
          { id: "a-linnea", name: "Linnea Corwin" },
          { id: "a-tobias", name: "Tobias Fairbank" },
        ],
        library: [],
        currentPlan: {
          title: "Tobias jumps",
          athleteId: "a-tobias",
          notes: "Old notes for Tobias.",
          moves: [],
        },
      },
      {
        attempt: async (c) => {
          seenByModel = JSON.stringify(c);
          return {
            title: "[ATHLETE 2] jump block",
            titleQuote: null,
            athleteName: "[ATHLETE 2]",
            athleteQuote: "[ATHLETE 2]",
            moves: [
              {
                name: "Double toe loop",
                nameQuote: null,
                description: "[ATHLETE 2] lands five.",
                descriptionQuote: null,
                cue: null,
                cueQuote: null,
                why: null,
                whyQuote: null,
                targetKind: "reps",
                targetValue: 5,
                targetQuote: null,
                matchExistingMoveId: null,
              },
            ],
            leftover: "[ATHLETE] is out.",
          } as unknown as Slots;
        },
        cleanup: async (o) => {
          notesPrompt = JSON.stringify(o);
          return "[ATHLETE] is out; [ATHLETE 2] keeps going.";
        },
      },
    );
    for (const name of ["Tobias", "Fairbank", "Linnea", "Corwin"]) {
      expect(seenByModel).not.toContain(name);
      expect(notesPrompt).not.toContain(name);
    }
    expect(draft.athleteId).toBe("a-tobias");
    expect(draft.title).toBe("Tobias jump block");
    expect(draft.moves[0]?.description).toBe("Tobias lands five.");
    expect(draft.notes).toBe("Linnea is out; Tobias keeps going.");
  });

  const roster = [
    { id: "a-sarah", name: "Sarah Kim" },
    { id: "a-linnea", name: "Linnea Corwin" },
    { id: "a-theo", name: "Theo Marsh" },
  ];
  const slotsFor = (athleteName: string | null, leftover = "") =>
    ({
      title: null,
      titleQuote: null,
      athleteName,
      athleteQuote: null,
      moves: [],
      leftover,
    }) as unknown as Slots;

  it("matches a name speech-to-text spelled another way (Lynnea for Linnea)", async () => {
    let seenByModel = "";
    const draft = await buildDraft(
      {
        mode: "create",
        transcript: "Okay, Lynnea. Start with spirals, then Axel and Flip.",
        athletes: roster,
        library: [],
      },
      {
        attempt: async (c) => {
          seenByModel = c.transcript;
          return slotsFor("[ATHLETE 2]");
        },
        cleanup: async () => "",
      },
    );
    expect(seenByModel).toBe("Okay, [ATHLETE 2]. Start with spirals, then Axel and Flip.");
    expect(draft.athleteId).toBe("a-linnea");
    expect(draft.unresolvedAthleteName).toBeNull();
  });

  it("masks a rostered name that is also a move or a word, said exactly", async () => {
    let seenByModel = "";
    await buildDraft(
      {
        mode: "create",
        transcript: "Axel needs flips. Avery: Lutz. Theo, then Filip.",
        athletes: [
          { id: "a-axel", name: "Axel Brandt" },
          { id: "a-avery", name: "Avery Penhallow" },
          { id: "a-theo", name: "Theo Marsh" },
          { id: "a-filip", name: "Filip Novak" },
        ],
        library: [],
      },
      {
        attempt: async (c) => {
          seenByModel = c.transcript;
          return slotsFor(null);
        },
        cleanup: async () => "",
      },
    );
    expect(seenByModel).toBe(
      "[ATHLETE] needs flips. [ATHLETE 2]: Lutz. [ATHLETE 3], then [ATHLETE 4].",
    );
  });

  it("masks a lower-case misspelling before the model sees it", async () => {
    let seenByModel = "";
    const draft = await buildDraft(
      { mode: "create", transcript: "plan for lynnea: spirals", athletes: roster, library: [] },
      {
        attempt: async (c) => {
          seenByModel = c.transcript;
          return slotsFor("[ATHLETE 2]");
        },
        cleanup: async () => "",
      },
    );
    expect(seenByModel).toBe("plan for [ATHLETE 2]: spirals");
    expect(draft.athleteId).toBe("a-linnea");
  });

  it("matches a spoken name the mask missed against the real roster, and sends no roster name", async () => {
    const seenByModel: string[] = [];
    let notesOpts: { athleteFirstName: string | null } | null = null;
    let notesPrompt = "";
    const draft = await buildDraft(
      {
        mode: "edit",
        // An everyday word in lower case ("lily") is left alone, so it
        // reaches the model as said. The fallback must add nothing.
        transcript: "plan for lily: spirals. Sarah and Theo watch.",
        athletes: [...roster, { id: "a-lilly", name: "Lilly Thorne" }],
        library: [],
        currentPlan: {
          title: "Lilly Thorne spirals",
          athleteId: "a-lilly",
          notes: "Lilly and Linnea Corwin share ice.",
          moves: [],
        },
      },
      {
        attempt: async (c) => {
          seenByModel.push(JSON.stringify(c));
          return slotsFor("lily", "[ATHLETE] and [ATHLETE 3] watch.");
        },
        cleanup: async (o) => {
          notesOpts = o;
          notesPrompt = JSON.stringify(o);
          return "";
        },
      },
    );
    expect(draft.athleteId).toBe("a-lilly");
    expect(draft.unresolvedAthleteName).toBeNull();
    expect(notesOpts!.athleteFirstName).toBe("[ATHLETE 4]");
    for (const sent of [...seenByModel, notesPrompt]) {
      // Ids are UUIDs in production; these test ids spell names.
      const words = sent.replace(/"(id|athleteId)":"[^"]*"/g, "");
      expect(words).not.toMatch(/\b(lilly|thorne|linnea|corwin|sarah|kim|theo|marsh)\b/i);
    }
  });

  it("masks each part of a two-part first name", async () => {
    let seenByModel = "";
    const draft = await buildDraft(
      {
        mode: "create",
        transcript: "Mary Kate needs spirals. Then Kate, then Mary.",
        athletes: [
          { id: "a-mk", name: "Mary Kate Wexley", firstName: "Mary Kate", lastName: "Wexley" },
          { id: "a-kd", name: "Kate Dunmore", firstName: "Kate", lastName: "Dunmore" },
        ],
        library: [],
      },
      {
        attempt: async (c) => {
          seenByModel = c.transcript;
          return slotsFor("[ATHLETE]");
        },
        cleanup: async () => "",
      },
    );
    // "Kate" alone is the Kate on the roster, not half of Mary Kate.
    expect(seenByModel).toBe("[ATHLETE] needs spirals. Then [ATHLETE 2], then [ATHLETE].");
    expect(draft.athleteId).toBe("a-mk");
  });

  it("masks typed move names and gives a kept move its stored name back", async () => {
    const seenByModel: string[] = [];
    const move = (name: string, matchExistingMoveId: string | null = null) => ({
      name,
      nameQuote: null,
      description: null,
      descriptionQuote: null,
      cue: null,
      cueQuote: null,
      why: null,
      whyQuote: null,
      targetKind: "reps",
      targetValue: 5,
      targetQuote: null,
      matchExistingMoveId,
    });
    const draft = await buildDraft(
      {
        mode: "edit",
        transcript: "Kate: keep the edge drill. Add the warmup. Linnea's spiral set gets longer.",
        athletes: [
          { id: "a-mk", name: "Mary Kate Wexley", firstName: "Mary Kate", lastName: "Wexley" },
          { id: "a-linnea", name: "Linnea Corwin" },
        ],
        library: [
          {
            id: "lib-1",
            name: "Linnea Corwin warmup",
            category: "Linnea extras",
            description: "",
            cue: "",
            why: "",
            defaultTargetKind: "reps",
            defaultTargetValue: 10,
          },
        ],
        currentPlan: {
          title: "Edges",
          athleteId: "a-mk",
          notes: "",
          moves: [
            { id: "pm-1", name: "Mary Kate edge drill", targetKind: "reps", targetValue: 5 },
            { id: "pm-2", name: "Linnea spiral set", targetKind: "reps", targetValue: 3 },
          ],
        },
      },
      {
        attempt: async (c) => {
          seenByModel.push(JSON.stringify(c));
          return {
            ...slotsFor(null),
            moves: [
              move(c.currentPlan!.moves[0]!.name, "pm-1"),
              move(c.library[0]!.name),
              move("[ATHLETE 2] long spirals", "pm-2"),
            ],
          } as unknown as Slots;
        },
        cleanup: async () => "",
      },
    );
    for (const sent of seenByModel) {
      const words = sent.replace(/"(id|athleteId)":"[^"]*"/g, "");
      expect(words).not.toMatch(/\b(mary|kate|wexley|linnea|corwin)\b/i);
    }
    // Unmasked as said, the first two would read "Kate edge drill" and "Linnea warmup".
    expect(draft.moves.map((m) => m.name)).toEqual([
      "Mary Kate edge drill",
      "Linnea Corwin warmup",
      "Linnea long spirals",
    ]);
    expect(draft.moves[1]?.libraryMoveId).toBe("lib-1");
  });

  it("keeps a pronoun or another name off the real roster", async () => {
    const athletes = [
      { id: "a-heather", name: "Heather Rook" },
      { id: "a-pam", name: "Pam Brannigan" },
    ];
    for (const spoken of ["her", "I", "Sam", "Heath"]) {
      const draft = await buildDraft(
        { mode: "create", transcript: "work on spins", athletes, library: [] },
        { attempt: async () => slotsFor(spoken), cleanup: async () => "" },
      );
      expect(draft.athleteId).toBeUndefined();
      expect(draft.unresolvedAthleteName).toBe(spoken);
    }
  });

  it("needs the last name when two rostered spellings share a key", async () => {
    const athletes = [
      { id: "a-katie", name: "Katie Nguyen" },
      { id: "a-katy", name: "Katy Vasko" },
    ];
    const resolve = (spoken: string) =>
      buildDraft(
        { mode: "create", transcript: "work on spins", athletes, library: [] },
        { attempt: async () => slotsFor(spoken), cleanup: async () => "" },
      );
    expect((await resolve("katey")).unresolvedAthleteName).toBe("katey");
    expect((await resolve("katey vasko")).athleteId).toBe("a-katy");
  });

  it("still reports a name that is not on the roster", async () => {
    const draft = await buildDraft(
      { mode: "create", transcript: "Bartholomew: spirals", athletes: roster, library: [] },
      { attempt: async () => slotsFor("Bartholomew"), cleanup: async () => "" },
    );
    expect(draft.athleteId).toBeUndefined();
    expect(draft.unresolvedAthleteName).toBe("Bartholomew");
  });
});
