import { describe, expect, it } from "bun:test";
import { createNameMask, nameSpellingKey, unmaskStrings } from "./ai-names";

describe("createNameMask", () => {
  const names = createNameMask([
    { role: "ATHLETE", firstName: "Sarah", lastName: "Kim" },
    { role: "PARENT", firstName: "Will", lastName: "Kim" },
    { role: "ATHLETE", firstName: "Grace", lastName: "Hill" },
  ]);

  it("masks full, first and last names, in any case, keeping possessives", () => {
    expect(names.mask("sarah kim and SARAH's mom; Sarah Kim")).toBe(
      "[ATHLETE] and [ATHLETE]'s mom; [ATHLETE]",
    );
    expect(names.mask("Coach told Kim")).toBe("Coach told [SURNAME 1]");
  });

  it("leaves everyday words alone unless capitalized", () => {
    expect(names.mask("you will see grace notes on the hill")).toBe(
      "you will see grace notes on the hill",
    );
    expect(names.mask("Will drove. Grace Hill skated.")).toBe(
      "[PARENT] drove. [ATHLETE 2] skated.",
    );
  });

  it("ignores accents, apostrophe styles, hyphens, and catches lowercase surnames", () => {
    const m = createNameMask([
      { role: "ATHLETE", firstName: "José", lastName: "O'Brien" },
      { role: "PARENT", firstName: "Anne-Marie", lastName: "Lindqvist" },
    ]);
    expect(m.mask("jose and Jose; O’Brien and o'brien; anne marie; lindqvist")).toBe(
      "[ATHLETE] and [ATHLETE]; [SURNAME 1] and [SURNAME 1]; [PARENT]; [SURNAME 2]",
    );
    expect(m.unmask("[ATHLETE]'s week")).toBe("José's week");
  });

  it("doesn't match inside longer words", () => {
    expect(names.mask("Sarahs Kimchi")).toBe("Sarahs Kimchi");
  });

  it("restores each placeholder as it first appeared", () => {
    const m = createNameMask([{ role: "ATHLETE", firstName: "Sarah", lastName: "Kim" }]);
    m.mask("Sarah worked hard");
    expect(m.unmask("[ATHLETE] and [ athlete ]")).toBe("Sarah and Sarah");
  });

  it("falls back to the first name for a placeholder it never replaced", () => {
    expect(
      createNameMask([{ role: "ATHLETE", firstName: "Sarah", lastName: "Kim" }]).unmask(
        "[ATHLETE]",
      ),
    ).toBe("Sarah");
  });

  it("catches near-miss spellings when fuzzy, but not everyday words", () => {
    const m = createNameMask([{ role: "ATHLETE", firstName: "Sarah", lastName: "Kim" }], {
      fuzzy: true,
    });
    expect(m.mask("Sara needs edges. Sarah too. Shall we?")).toBe(
      "[ATHLETE] needs edges. [ATHLETE] too. Shall we?",
    );
    expect(m.unmask("[ATHLETE]")).toBe("Sarah");
  });

  it("catches a name speech-to-text spelled another way (Lynnea for Linnea)", () => {
    const m = createNameMask(
      [
        { role: "ATHLETE", firstName: "Sarah", lastName: "Kim" },
        { role: "ATHLETE", firstName: "Linnea", lastName: "Corwin" },
      ],
      { fuzzy: true },
    );
    expect(m.mask("Lynnea needs spirals.")).toBe("[ATHLETE 2] needs spirals.");
    // Written back as said, until the name is spelled right.
    expect(m.unmask("[ATHLETE 2] skated")).toBe("Lynnea skated");
    expect(m.mask("Linea, Lynea and Linnea's edges")).toBe(
      "[ATHLETE 2], [ATHLETE 2] and [ATHLETE 2]'s edges",
    );
    expect(m.unmask("[ATHLETE 2] skated")).toBe("Linnea skated");
  });

  it("matches spelling variants both ways, three-letter names included", () => {
    const pairs: [string, string][] = [
      ["Linnea", "Lynnea"],
      ["Lynnea", "Linnea"],
      ["Linea", "Lynnea"],
      ["Sarah", "Sara"],
      ["Sara", "Sarah"],
      ["Katie", "Katy"],
      ["Katy", "Katie"],
      ["Katie", "Katey"],
      ["Jon", "John"],
      ["John", "Jon"],
      ["Zoe", "Zoey"],
      ["Zoe", "Zoie"],
      ["Zoey", "Zoe"],
    ];
    for (const [rostered, spoken] of pairs) {
      const m = createNameMask([{ role: "ATHLETE", firstName: rostered, lastName: null }], {
        fuzzy: true,
      });
      expect(m.mask(`${spoken} skated.`)).toBe("[ATHLETE] skated.");
    }
  });

  it("takes an everyday word for a rostered name by its spelling key only", () => {
    const mask = (first: string, text: string) =>
      createNameMask([{ role: "ATHLETE", firstName: first, lastName: null }], {
        fuzzy: true,
      }).mask(text);
    // The same name spelled the everyday way.
    expect(mask("Lilly", "Lily lands it.")).toBe("[ATHLETE] lands it.");
    expect(mask("Myles", "Miles lands it.")).toBe("[ATHLETE] lands it.");
    // One edit from an everyday word is not enough, and "Joy" is no Joe.
    expect(mask("Willa", "Will you land it?")).toBe("Will you land it?");
    expect(mask("Joe", "Joy in the jumps.")).toBe("Joy in the jumps.");
  });

  it("leaves the capitalized words of a dictation alone, even near a roster name", () => {
    const roster = [
      "Linnea Corwin",
      "Sarah Kim",
      "Katie Nguyen",
      "Jon Park",
      "Theo Marsh",
      "Thea Lund",
      "Stuart Reyes",
      "Filip Novak",
      "Abel Ortiz",
      "Aldo Ricci",
      "Avery Cole",
      "Ben Ito",
    ];
    const m = createNameMask(
      roster.map((n) => {
        const [firstName, lastName] = n.split(" ");
        return { role: "ATHLETE" as const, firstName, lastName };
      }),
      { fuzzy: true },
    );
    const words = [
      "Okay",
      "Alright",
      "The",
      "Then",
      "After",
      "Also",
      "Saturday",
      "Thursday",
      "Start",
      "Finish",
      "Spirals",
      "Harness",
      "Mohawks",
      "Axel",
      "Lutz",
      "Salchow",
      "Loop",
      "Flip",
      "Every",
      "Very",
      "Been",
      "They",
    ];
    for (const w of words) expect(m.mask(`${w} again.`)).toBe(`${w} again.`);
    expect(
      m.mask("Okay, Lynnea. Start with Spirals, then Axel. After that Theo does Flip, Lutz."),
    ).toBe(
      "Okay, [ATHLETE]. Start with Spirals, then Axel. After that [ATHLETE 5] does Flip, Lutz.",
    );
  });

  it("gives each person a placeholder in input order", () => {
    expect(names.personTokens).toEqual(["[ATHLETE]", "[PARENT]", "[ATHLETE 2]"]);
  });
});

describe("createNameMask — no rostered name reaches the model (App Review 5.1.2(i))", () => {
  it("still masks a rostered name that is also a dictation or everyday word, said exactly", () => {
    // DICTATION_WORDS and EVERYDAY_WORD_NAMES only hold back the fuzzy pass.
    const listed = [
      "Axel",
      "Flip",
      "Even",
      "Sunday",
      "May",
      "Will",
      "Grace",
      "Max",
      "Rose",
      "Avery",
      "Theo",
      "Filip",
    ];
    for (const first of listed) {
      const m = createNameMask([{ role: "ATHLETE", firstName: first, lastName: "Brandt" }], {
        fuzzy: true,
      });
      expect(m.mask(`${first} lands it. ${first.toUpperCase()}'s edges.`)).toBe(
        "[ATHLETE] lands it. [ATHLETE]'s edges.",
      );
      expect(m.mask(`Plan for ${first} Brandt.`)).toBe("Plan for [ATHLETE].");
    }
    // Beside a name one edit away, each keeps its own placeholder.
    const m = createNameMask(
      [
        { role: "ATHLETE", firstName: "Abel", lastName: "Ortiz" },
        { role: "ATHLETE", firstName: "Axel", lastName: "Brandt" },
        { role: "ATHLETE", firstName: "Filip", lastName: "Novak" },
        { role: "ATHLETE", firstName: "Flip", lastName: "Haldane" },
      ],
      { fuzzy: true },
    );
    expect(m.mask("Axel and Abel; Flip and Filip.")).toBe(
      "[ATHLETE 2] and [ATHLETE]; [ATHLETE 4] and [ATHLETE 3].",
    );
  });

  it("doesn't strip move names out of a dictation for a common roster", () => {
    const roster = [
      "Olivia",
      "Emma",
      "Ava",
      "Sophia",
      "Mia",
      "Amelia",
      "Harper",
      "Evelyn",
      "Avery",
      "Chloe",
      "Zoe",
      "Lily",
      "Lilly",
      "Ella",
      "Leah",
      "Nora",
      "Lucy",
      "Harriet",
      "Carmel",
      "Liam",
      "Noah",
      "Oliver",
      "Elijah",
      "Lucas",
      "Leo",
      "Theo",
      "Thea",
      "Abel",
      "Filip",
      "Walt",
      "Wally",
      "Tess",
      "Cole",
      "Finn",
      "Lane",
      "Owen",
      "Seth",
      "Troy",
      "Neve",
      "Lou",
      "Luz",
      "Sal",
      "Ben",
      "Sam",
      "Cal",
      "Mai",
      "Eli",
      "Kai",
      "Jon",
      "Bodie",
      "Tripp",
      "Minnie",
      "Wynter",
      "Myles",
    ];
    const m = createNameMask(
      roster.map((firstName) => ({ role: "ATHLETE" as const, firstName, lastName: null })),
      { fuzzy: true },
    );
    const dictation = [
      "The Lutz needs height. Loop, then Axel. Salchow entries on the Harness.",
      "Spirals across the ice. Flip and Toe loop. Waltz jumps. Walley too.",
      "Camel spin, Layback, Twizzles. Mohawks and Choctaws. Test session in May.",
      "Lutzes. Loops. Axels. Salchows. Flips. Spiral sequence. Harness work on the Pole.",
      "Very good. Open the hip. Set up the edge. Try again. Never cheat. Line up. Fine.",
      // Lower case, where only the spelling key applies.
      "the lutz needs height, then a loop and an axel. salchow entries on the harness,",
      "spirals across, flip and toe loop. upper body position. a trip to regionals.",
      "mini session in winter. run two miles. you will see grace in the rose spiral.",
    ].join(" ");
    expect(m.mask(dictation)).toBe(dictation);
  });

  it("masks each part of a two-part first name, after a whole first name", () => {
    const m = createNameMask(
      [
        { role: "ATHLETE", firstName: "Mary Kate", lastName: "Wexley" },
        { role: "ATHLETE", firstName: "Kate", lastName: "Dunmore" },
        { role: "ATHLETE", firstName: "Ella Rose", lastName: "Brandt" },
        { role: "PARENT", firstName: "Anne-Marie", lastName: "Thorne" },
      ],
      { fuzzy: true },
    );
    expect(m.mask("Mary Kate, then Kate. Mary again. MARY's edges.")).toBe(
      "[ATHLETE], then [ATHLETE 2]. [ATHLETE] again. [ATHLETE]'s edges.",
    );
    // An everyday-word part only when capitalized, like a first name.
    expect(m.mask("Ella Rose, Rose and Ella; the rose spiral.")).toBe(
      "[ATHLETE 3], [ATHLETE 3] and [ATHLETE 3]; the rose spiral.",
    );
    expect(m.mask("Marie called, and Katie.")).toBe("[PARENT] called, and [ATHLETE 2].");
  });

  it("masks typed text for exact names only when asked", () => {
    const m = createNameMask([{ role: "ATHLETE", firstName: "Linnea", lastName: "Corwin" }], {
      fuzzy: true,
    });
    expect(m.mask("Lynnea spiral set", { fuzzy: false })).toBe("Lynnea spiral set");
    expect(m.mask("Linnea spiral set; Corwin warmup", { fuzzy: false })).toBe(
      "[ATHLETE] spiral set; [SURNAME 1] warmup",
    );
    expect(m.mask("Lynnea spiral set")).toBe("[ATHLETE] spiral set");
  });

  it("masks a lower-case misspelling by its spelling key, never by edit distance", () => {
    const mask = (first: string, text: string) =>
      createNameMask([{ role: "ATHLETE", firstName: first, lastName: null }], {
        fuzzy: true,
      }).mask(text);
    expect(mask("Linnea", "plan for lynnea and linea")).toBe("plan for [ATHLETE] and [ATHLETE]");
    expect(mask("Sarah", "sara lands it")).toBe("[ATHLETE] lands it");
    expect(mask("Zoe", "zoey lands it")).toBe("[ATHLETE] lands it");
    // In lower case one edit is not enough, and a three-letter word is left alone.
    expect(mask("Sarah", "sarahs and saran wrap")).toBe("sarahs and saran wrap");
    expect(mask("Jon", "john lands it, jon too")).toBe("[ATHLETE] lands it, [ATHLETE] too");
    expect(mask("John", "jon lands it")).toBe("jon lands it");
    // Everyday words and dictation words stay in lower case.
    expect(mask("Lilly", "lily pad drill")).toBe("lily pad drill");
    expect(mask("Wynter", "winter season")).toBe("winter season");
    expect(mask("Bodie", "upper body")).toBe("upper body");
  });
});

describe("nameSpellingKey", () => {
  it("gives speech-to-text spellings of one name the same key", () => {
    const same = [
      ["Linnea", "Lynnea", "Linea", "Lynea", "Linnéa", "LINNEA"],
      ["Sara", "Sarah"],
      ["Katie", "Katy", "Katey"],
      ["Jon", "John"],
      ["Philip", "Phillip", "Filip"],
      ["Zoë", "Zoe"],
      ["Lilly", "Lily", "Lili"],
    ];
    for (const group of same) {
      expect(new Set(group.map(nameSpellingKey)).size).toBe(1);
    }
  });

  it("keeps different words apart", () => {
    expect(nameSpellingKey("Ben")).not.toBe(nameSpellingKey("Been"));
    expect(nameSpellingKey("Theo")).not.toBe(nameSpellingKey("Then"));
    expect(nameSpellingKey("Filip")).not.toBe(nameSpellingKey("Flip"));
    expect(nameSpellingKey("Linnea")).not.toBe(nameSpellingKey("Lena"));
  });
});

describe("unmaskStrings", () => {
  it("unmasks strings at any depth and leaves other values alone", () => {
    const m = createNameMask([{ role: "ATHLETE", firstName: "Sarah", lastName: null }]);
    expect(unmaskStrings({ a: "[ATHLETE]", b: ["x [ATHLETE]"], c: 3, d: null }, m.unmask)).toEqual({
      a: "Sarah",
      b: ["x Sarah"],
      c: 3,
      d: null,
    });
  });
});
