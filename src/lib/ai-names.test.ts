import { describe, expect, it } from "bun:test";
import { createNameMask, unmaskStrings } from "./ai-names";

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

  it("gives each person a placeholder in input order", () => {
    expect(names.personTokens).toEqual(["[ATHLETE]", "[PARENT]", "[ATHLETE 2]"]);
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
